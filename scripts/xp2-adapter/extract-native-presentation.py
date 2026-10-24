#!/usr/bin/env python3
"""Extract a revision-preserving presentation sidecar from the XP2 native books.

The trusted repository adapter is replayed against already-extracted JSON books,
without loading the game or writing a replacement story. Every command/event
anchor is checked against the existing story before the sidecar is written.
"""
import argparse,collections,copy,hashlib,json,math,pathlib,re

def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def number(value,default=0):
    try:return float(value) if value else default
    except (TypeError,ValueError):return default

def extract(args):
    repo=pathlib.Path(__file__).resolve().parents[2]
    story_path=args.story or repo/'private/story-player/data/story.json'
    story=read_json(story_path)
    index=read_json(args.index or story_path.with_name('unity-index.json'))
    translation=read_json(args.translations or story_path.with_name('translations.json'))
    grids=read_json(args.analysis_dir/'grids.json')
    setting_grids=read_json(args.analysis_dir/'main-settings.json')
    adapter_path=repo/'scripts/prepare-xp2.py'
    source=adapter_path.read_text(encoding='utf-8-sig')
    source=source[source.index("tr={x['id']:"):source.index('# Translation-only original UI')]
    traces=[]
    # Only the trusted local converter is executed. No scenario source, game
    # assembly, user translation or asset is treated as executable code.
    marker=" for d in seg['rows']:\n"
    if source.count(marker)!=1:raise ValueError('Adapter row loop changed; review trace instrumentation.')
    source=source.replace(marker,marker+"  _rowCommandStart=len(scene['commands']);_rowEventStart=len(scene['events'])\n")
    marker=" # Limit arbitrary auto-advancing actor-only clips"
    if source.count(marker)!=1:raise ValueError('Adapter row footer changed; review trace instrumentation.')
    source=source.replace(marker,"  _traces.append(dict(sceneId=sid,sourceGrid=g['name'],sourceRow=d['_row'],row=dict(d),beforeCommandIndex=_rowCommandStart,commandIndexes=list(range(_rowCommandStart,len(scene['commands']))),eventIndexes=list(range(_rowEventStart,len(scene['events'])))))\n"+marker)
    context=dict(translation=translation,index=index,resource_paths=index.get('resourcePaths',{}),
        grids=grids,setting_grids=setting_grids,collections=collections,copy=copy,re=re,math=math,_traces=traces)
    exec(compile(source,str(repo/'scripts/prepare-xp2.py')+'[presentation-trace]','exec'),context)
    current={s['id']:s for s in story['scenes']}
    for generated in context['scenes']:
        actual=current.get(generated['id'])
        if actual is None:raise ValueError('Missing generated scene '+generated['id'])
        for field in ['commands','events']:
            if generated[field]!=actual[field]:raise ValueError(f'Converter {field} differ from current story at {generated["id"]}; do not use guessed anchors.')
    layers=context['layers'];characters=context['characters'];texture=context['texture']
    character_names={k[0] for k in characters}
    sprite_names={t['row'].get('Arg1') for t in traces if t['row']['_cmd']=='Sprite'}
    layer_names=list(layers)
    def selector(target):
        if target=='MessageWindow':return dict(targetKind='messageWindow',targetIds=[])
        if target=='BG':return dict(targetKind='background',targetIds=['bg:'+n for n,d in layers.items() if d.get('Type')=='Bg'],targetResolution='first-present-in-native-layer-order')
        candidates=[]
        if target in character_names:candidates.append('char:'+target)
        if target in sprite_names:candidates.append('sprite:'+target)
        if candidates:return dict(targetKind='actor',targetIds=candidates)
        if target in layers:return dict(targetKind='layer',targetIds=[],layerName=target)
        return dict(targetKind='unresolved',targetIds=[])
    scenes=collections.defaultdict(list);counts=collections.Counter();waits=collections.defaultdict(collections.Counter);presets=collections.Counter();unsupported=[];bindings={};dialogue_speakers=collections.defaultdict(dict)
    presentation_commands={'Tween','Shake','GuiActive','Bg','BgEvent','BgOff','BgEventOff','Sprite','SpriteOff','CharacterOff'}
    for trace in traces:
        row=trace['row'];command=row['_cmd'];counts[command or 'CharacterOrText']+=1
        actual=current[trace['sceneId']]
        events=[actual['events'][i] for i in trace['eventIndexes']]
        for event_index in trace['eventIndexes']:
            if actual['events'][event_index]['type']=='dialogue':
                label=row.get('Arg1','')
                dialogue_speakers[trace['sceneId']][str(event_index)]=dict(actorId='char:'+label if label else None,sourceLabel=label,sourceRow=trace['sourceRow'])
        if command not in presentation_commands and not (command=='' and row.get('Arg1') and trace['eventIndexes']):continue
        if command=='' and not any(e['type']=='character' for e in events):continue
        native_command=command or 'Character'
        item={k:v for k,v in trace.items() if k!='row' and k!='sceneId'}
        item.update(id=f'native:{trace["sourceGrid"].split(":")[-1]}:{trace["sourceRow"]}',command=native_command,target=row.get('Arg1',''),rawArgs=[row.get('Arg'+str(i),'') for i in range(1,7)],waitType=row.get('WaitType','') or 'Default')
        item['hasWaitSemantics']=command in ['Tween','Shake']
        if command in ['Tween','Shake']:
            params=dict((k,number(v)) for k,v in re.findall(r'([a-zA-Z]+)=([-+.0-9]+)',row.get('Arg3','')))
            item.update(selector(item['target']))
            item['normalizedTarget']='messageWindow' if item['targetKind']=='messageWindow' else ('layer:'+item.get('layerName','') if item['targetKind']=='layer' else None)
            item['normalizedTargets']=['character:'+id for id in item['targetIds']]
            item.update(operation='ShakePosition' if command=='Shake' else row.get('Arg2',''),parameters=params,duration=params.get('time',1),ease=row.get('Arg4') or 'easeOutExpo',loop=row.get('Arg5') or 'none',isLocal=False,coordinateSpace='world-center-origin-y-up',pixelToWorld=100)
            item['replaceEventIndexes']=[i for i in item['eventIndexes'] if actual['events'][i]['type'] in ['camera','tween']]
            if command=='Shake':item['randomness']='native-per-frame-UnityEngine.Random.Range; browser replay must declare deterministic approximation'
            waits[command][item['waitType']]+=1
            presets[(command,item['operation'],row.get('Arg3',''),item['ease'],item['loop'])]+=1
            if item['targetKind']=='unresolved':unsupported.append(dict(id=item['id'],target=item['target'],reason='No native object/layer in source settings; native engine logs target-not-found and completes command.'))
        elif command=='GuiActive':
            item.update(operation='SetActive',active=row.get('Arg2','').upper()=='TRUE')
        else:
            item.update(operation='draw' if native_command in ['Bg','BgEvent','Sprite','Character'] else 'clear',duration=number(row.get('Arg6'),.2),targetKind='actor',targetIds=[e['id'] for e in events if e['type']=='character'])
            item['fadeEventIndexes']=[i for i in item['eventIndexes'] if actual['events'][i]['type'] in ['character','clearActors','mode']]
            if native_command in ['Bg','BgEvent','Sprite']:
                label=(row.get('Arg2') or row.get('Arg1')) if native_command=='Sprite' else row.get('Arg1');settings=texture.get(label,{})
            elif native_command=='Character':settings=characters.get((row.get('Arg1'),row.get('Arg2',''))) or characters.get((row.get('Arg1'),'')) or {}
            else:settings={}
            item['textureOffset']={'x':number(settings.get('X')),'y':number(settings.get('Y'))}
            for event in events:
                if event['type']!='character' or not event.get('asset'):continue
                binding=bindings.setdefault(event['id'],dict(kind=event.get('kind','character'),assets={},offsetVariants={},layerNames=[]))
                variants=binding['offsetVariants'].setdefault(event['asset'],[])
                if item['textureOffset'] not in variants:variants.append(dict(item['textureOffset']))
                # Multiple labels may deliberately bind the same texture with
                # different child offsets. Only the actual draw action is
                # authoritative; avoid a misleading global last-value fallback.
                if len(variants)==1:binding['assets'][event['asset']]=dict(item['textureOffset'])
                else:binding['assets'].pop(event['asset'],None)
                if event.get('layerName') not in binding['layerNames']:binding['layerNames'].append(event.get('layerName'))
            if row.get('Arg4'):item['positionX']=number(row['Arg4'])
            if row.get('Arg5'):item['positionY']=number(row['Arg5'])
        scenes[trace['sceneId']].append(item)
    ui=read_json(args.ui_inventory) if args.ui_inventory else None
    configs={}
    if ui:
        for c in ui['components']:
            if c['class'] in ['AdvConfig','AdvEffectManager','AdvUguiMessageWindow','AdvCharacterGrayOutController']:
                configs[c['class']]=dict(componentId=c['id'],path=ui['gameObjects'][c['gameObject']]['path'],data=c['data'])
    manifest=dict(type='xp2-native-presentation',schemaVersion=1,storyId=story['id'],
        sourceStorySha256=hashlib.sha256(story_path.read_bytes()).hexdigest(),
        sourceBook='mochimochi11th.xls / Main.chapter',
        sourceHashes={name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in {
            'grids.json':args.analysis_dir/'grids.json','main-settings.json':args.analysis_dir/'main-settings.json',
            'prepare-xp2.py':adapter_path,'unity-index.json':args.index or story_path.with_name('unity-index.json')}.items()},
        defaults=dict(stage=dict(width=1280,height=720),nativeBackgroundObject='BG',
            tween=dict(time=1,delay=0,ease='easeOutExpo',loop='none',isLocal=False,space='Self',pixelToWorld=100,waitType='Default'),
            shake=dict(operation='ShakePosition',x=30,y=30,amplitudeEnvelope='1-progress',randomness='UnityEngine.Random.Range each native update'),
            graphicFadeSeconds=.2,defaultLayers=context['default_layers']),
        layers={name:dict(type=d.get('Type'),x=number(d.get('X')),y=number(d.get('Y')),order=number(d.get('Order'))) for name,d in layers.items()},
        scenes=dict(scenes),bindings=bindings,dialogueSpeakers=dict(dialogue_speakers),nativeUiSettings=configs,
        nativeConfigCurves=dict(characterWaitSeconds='(1-messageSpeed)*0.1',defaultMessageSpeed=.5,defaultCharactersPerSecond=20,
            autoPageWaitSeconds='(1-autoBrPageSpeed)*2.5',defaultAutoBrPageSpeed=.5,defaultAutoPageWaitSeconds=1.25,
            messageWindowAlpha='1-messageWindowTransparency',defaultMessageWindowTransparency=.3,defaultMessageWindowAlpha=.7,
            evidence='AdvConfig.GetTimeSendChar MethodDef2460; get_AutoPageWaitTime2465; get_MessageWindowAlpha2468; level0:1206'),
        audit=dict(scenarioCommandCounts=dict(counts),presentationEntries=sum(map(len,scenes.values())),scenes=len(scenes),verifiedSceneAnchors=len(context['scenes']),
            tweenCount=counts['Tween'],shakeCount=counts['Shake'],guiActiveCount=counts['GuiActive'],
            effectWaitTypes={k:dict(v) for k,v in waits.items()},zeroEventTween=sum(1 for entries in scenes.values() for x in entries if x['command']=='Tween' and not x['eventIndexes']),
            explicitCameraCommands=counts['Camera'],explicitFadeCommands=counts['Fade'],explicitWindowCommands=counts['Window'],unsupportedTargets=unsupported,
            ambiguousAssetOffsets=[dict(actorId=id,assetId=asset,offsets=variants) for id,binding in bindings.items() for asset,variants in binding['offsetVariants'].items() if len(variants)>1],
            uniqueTweenTargetInvocations=len({(t['row'].get('Arg1',''),t['row'].get('Arg2',''),t['row'].get('Arg3','')) for t in traces if t['row']['_cmd']=='Tween'}),
            uniquePresets=[dict(command=k[0],operation=k[1],rawParameters=k[2],ease=k[3],loop=k[4],uses=v) for k,v in sorted(presets.items())]),
        evidence=dict(assembly='Assembly-CSharp.dll, statically inspected only',methods={
            'iTween.Defaults..cctor':'MethodDef 6067: time=1 delay=0 easeType=16(easeOutExpo) isLocal=false space=1(Self)',
            'AdvCommandTween.InitTweenData':'MethodDef 1220: Arg2 type, Arg3 numeric args, Arg4 ease, Arg5 loop',
            'AdvCommandShake.InitTweenData':'MethodDef 1215: ShakePosition, Arg3 parameters; add x=30,y=30 only when both absent',
            'AdvCommandTween.OnParse':'MethodDef 1219: WaitType column then legacy Arg6; empty parses to Default(enum0), distinct from Add(enum3) and NoWait(enum4)',
            'AdvCommandWaitBase.Wait':'MethodDef1143: Default waits wait-manager; Add starts without blocking its own command; NoWait excluded from waitCommandList',
            'AdvCommand.Wait':'MethodDef892 always returns false: graphic draw/Off commands do not gain Tween wait semantics from empty WaitType cells',
            'AdvCommandWaitTypeExtensions.IsWaitingCommandType':'MethodDef3136: Default/Add/Skippable/AddSkippable/SkippableOnWaitThread participate in following Default wait gates',
            'AdvITweenPlayer.Init':'MethodDef 1747: position params/100 in 2D unless explicit isLocal=true',
            'iTween.GenerateMoveToTargets':'MethodDef 303: world transform.position unless isLocal=true',
            'AdvEffectManager.FindTarget':'MethodDef 1741: MessageWindow→UI message manager; default→FindObjectOrLayer then named message window',
            'AdvCommandBgBase..ctor':'MethodDef 937: fadeTime Arg6 default .2',
            'AdvCommandCharacter..ctor':'MethodDef 947: fadeTime Arg6 default .2',
            'AdvGraphicLayer.DrawToDefault':'MethodDef 2032: retain swapFade old graphic and new graphic during transition'},
            limitations=['Native frame RNG is not serializable; a reproducible browser shake can preserve target, amplitude, time and decay but not the identical random samples.',
                'Native discussion minigame logic is outside this presentation manifest.',
                'No Camera/Fade/Window commands are authored in the supplied scenario book; fades are graphic command Arg6 transitions.']))
    dest=args.output or story_path.with_name('native-presentation.json')
    dest.write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in manifest['audit'].items() if k not in ['scenarioCommandCounts','uniquePresets','unsupportedTargets']},ensure_ascii=True))
    print('output',str(dest),'bytes',dest.stat().st_size,'unresolved targets',len(unsupported))
    return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--analysis-dir',required=True,type=pathlib.Path)
    p.add_argument('--story',type=pathlib.Path);p.add_argument('--index',type=pathlib.Path);p.add_argument('--translations',type=pathlib.Path)
    p.add_argument('--ui-inventory',type=pathlib.Path);p.add_argument('--output',type=pathlib.Path)
    extract(p.parse_args())
