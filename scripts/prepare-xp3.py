#!/usr/bin/env python3
"""Prepare the independent XP3 v1.10 local-file player without copying game media.

Requires scripts/xp2-adapter/requirements.txt. The existing reviewed UnityFS,
Utage grid and scene converter is reused as repository code, never game code.
Pass --catalog from the universal translation workbench to preserve every UI and
discussion field as well as scenario text. IDs and fingerprint match that tool.
"""
import argparse, base64, bisect, collections, copy, hashlib, importlib.util, io
import json, math, pathlib, re, struct, subprocess, sys, tempfile, zlib
from pathlib import Path
sys.dont_write_bytecode = True


def write_json(path, value, pretty=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2 if pretty else None,
                               separators=None if pretty else (',', ':')), encoding='utf-8')


def fingerprint(metadata):
    return 'xp3-1.10:' + hashlib.sha256(metadata.read_bytes()).hexdigest()


def make_workbench_profile(context, game, root, book, chapter):
    """Same bounded byte-offset profile schema as the existing translation tool."""
    env = context['env']
    textures, sprites, paths, fonts, ui_objects = {}, {}, {}, [], []
    objects = {}
    for name, obj in [('book', book), ('chapter', chapter)]:
        objects[name] = dict(asset=obj.assets_file.name, offset=obj.byte_start,
                             size=obj.byte_size, sha256=hashlib.sha256(obj.get_raw_data()).hexdigest())
    for obj in env.objects:
        key = f'{obj.assets_file.name}:{obj.path_id}'
        if obj.type.name == 'Texture2D':
            t = obj.read_typetree()
            textures[key] = dict(asset=obj.assets_file.name, name=t['m_Name'], width=t['m_Width'],
                                 height=t['m_Height'], format=t['m_TextureFormat'],
                                 stream=t['m_StreamData'], offset=obj.byte_start, size=obj.byte_size)
        elif obj.type.name == 'Sprite':
            t = obj.read_typetree(); rd = t.get('m_RD', {}); ptr = rd.get('texture', {})
            from UnityPy.classes.PPtr import PPtr
            tex = PPtr(m_FileID=ptr['m_FileID'], m_PathID=ptr['m_PathID'], assetsfile=obj.assets_file).deref() if ptr.get('m_PathID') else None
            sprites[key] = dict(name=t['m_Name'], texture=f'{tex.assets_file.name}:{tex.path_id}' if tex else None,
                                rect=t.get('m_Rect'), textureRect=rd.get('textureRect'),
                                textureRectOffset=rd.get('textureRectOffset'), settingsRaw=rd.get('settingsRaw', 0),
                                pivot=t.get('m_Pivot'), pixelsToUnits=t.get('m_PixelsToUnits', 100))
        elif obj.type.name == 'ResourceManager':
            for name, ptr in obj.read().m_Container:
                if not ptr.m_PathID: continue
                item = ptr.deref()
                if item.type.name == 'Texture2D':
                    paths[name.replace('\\', '/').lower()] = f'{item.assets_file.name}:{item.path_id}'
        elif obj.type.name == 'Font':
            t = obj.read_typetree()
            fonts.append(dict(name=t['m_Name'], asset=obj.assets_file.name, pathID=obj.path_id,
                              size=obj.byte_size, offset=obj.byte_start))
        elif obj.type.name == 'RectTransform' and obj.assets_file.name == 'level0':
            try:
                t = obj.read_typetree(); name = obj.read().m_GameObject.read().m_Name
                if name in ['NameText', 'Text Main', 'MessageText', 'MessageWindow', 'Text']:
                    ui_objects.append(dict(name=name, pathID=obj.path_id, data={k:v for k,v in t.items() if k not in ['m_CorrespondingSourceObject','m_PrefabInstance','m_PrefabAsset']}))
            except (KeyError, ValueError): pass
    # ResourceManager resolves exact copies of textures kept in the scene and
    # Resources. Only identical dimensions/format and resource stream qualify.
    aliases = {}
    signatures = collections.defaultdict(list)
    for key, tex in textures.items():
        st = tex['stream']; signatures[(tex['name'],tex['width'],tex['height'],tex['format'],st['path'],st['offset'],st['size'])].append(key)
    for group in signatures.values():
        canonical = next((k for k in group if k.startswith('resources.assets:')), None)
        if canonical:
            for key in group:
                if key != canonical: aliases[key] = canonical
    profile = dict(schema=1, id='xp3-1.10', gameName='性癖讨论3 v1.10',
                   bundleSize=(game/'data.unity3d').stat().st_size, unityVersion='2022.3.19f1',
                   width=1280,height=720,objects=objects,textures=textures,sprites=sprites,
                   resourcePaths=paths,fonts=fonts,uiObjects=ui_objects,
                   metadataSha256=hashlib.sha256((root/'serialized/sharedassets0.assets').read_bytes()).hexdigest(),
                   textureAliases=aliases)
    write_json(root/'workbench-profile.json', profile)
    return profile


def native_shell(destination, settings, inventory):
    recalls, cgs = [], []
    for grid in settings:
        kind = grid['name'].rsplit(':',1)[-1]
        for row in grid['rows'][1:]:
            if row['isEmpty'] or row['isCommentOut']: continue
            d = dict(zip(grid['rows'][0]['strings'],row['strings']))
            if kind == 'SceneGallery' and d.get('ScenarioLabel'):
                recalls.append(dict(scenario=d['ScenarioLabel'],title=d.get('Title') or d['ScenarioLabel'],
                    titleId=f"setting:{grid['name']}|{row['rowIndex']}|Title",thumbnail=d.get('Thumbnail','')))
            if kind == 'Texture' and d.get('Type','').lower() == 'event' and d.get('FileName'):
                cgs.append(dict(label=d['Label'],file=d['FileName'],category=d.get('CgCategolly',''),
                    thumbnail=d.get('Thumbnail') or d['FileName'],sourceRow=row['rowIndex']))
    ui_paths = {
        'title':'Canvas-AdvUI/Title','start':'Canvas-AdvUI/Title/StartGame',
        'resume':'Canvas-AdvUI/Title/LoadGame','config':'Canvas-AdvUI/Title/Config',
        'gallery':'Canvas-AdvUI/Title/Gallery','galleryBackground':'Canvas-AdvUI/Gallery',
        'configBackground':'Canvas-AdvUI/Config','galleryTabCg':'Canvas-AdvUI/Gallery/DivTop/TabButtons/CgGallery',
        'galleryTabScene':'Canvas-AdvUI/Gallery/DivTop/TabButtons/SceneGallery',
        'close':'Canvas-AdvUI/Config/Buttons/Button-Back','defaults':'Canvas-AdvUI/Config/Buttons/Button-DefaultAll',
        'messageWindow':'AdvEngine/UI/MessageWindowManager/MessageWindow/RootChildren/MessageWindowCanvas/Image'}
    ui = {}
    for name, path in ui_paths.items():
        component = next(c for c in inventory['components'] if c['class']=='Image' and inventory['gameObjects'][c['gameObject']]['path']==path)
        ui[name] = inventory['sprites'][component['sprite']]['texture']
    # Native UguiButtonSe references point into sharedassets0 (fileID 3).
    sounds = next(c['data'] for c in inventory['components'] if c['class']=='UguiButtonSe')
    ui['click'] = f"audio:sharedassets0.assets:{sounds['clicked']['m_PathID']}"
    ui['hover'] = f"audio:sharedassets0.assets:{sounds['highlited']['m_PathID']}"
    output = '// Generated from XP3 v1.10 native settings and Unity UI references.\n'
    for name, value in [('NATIVE_RECALLS',recalls),('NATIVE_CGS',cgs),('NATIVE_CG_DESTINATIONS',{}),('NATIVE_UI',ui),
                        ('NATIVE_READING_DEFAULTS',dict(autoSpeed=1,textSpeed=20,dialogueOpacity=.2,masterVolume=1,bgmVolume=1,seVolume=1,voiceVolume=1,ambientVolume=1))]:
        output += f'export const {name} = '+json.dumps(value,ensure_ascii=False,separators=(',',':'))+';\n'
    (destination/'src').mkdir(exist_ok=True)
    (destination/'src/game-shell-data.js').write_text(output,encoding='utf-8')
    return len(recalls),len(cgs)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game',required=True,type=Path)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'private/story-player-xp3')
    parser.add_argument('--analysis-dir',type=Path)
    parser.add_argument('--dependencies',type=Path)
    parser.add_argument('--catalog',type=Path,help='Complete blank or translated workbench document, fingerprint checked')
    args=parser.parse_args()
    if args.dependencies: sys.path.insert(0,str(args.dependencies.resolve()))
    import lz4.block,UnityPy,fsb5
    from fsb5.vorbis_headers import lookup
    repo=Path(__file__).resolve().parents[1]; game=args.game.resolve()
    if not game.name.endswith('_Data'):
        choices=list(game.glob('*_Data'))
        if len(choices)!=1:raise ValueError('Select one original game directory containing one *_Data directory.')
        game=choices[0]
    dest=args.output.resolve();data=dest/'data';data.mkdir(parents=True,exist_ok=True)
    write_json(dest/'package.json',dict(private=True,type='module'))
    temp=None
    if args.analysis_dir:root=args.analysis_dir.resolve();root.mkdir(parents=True,exist_ok=True)
    else:temp=tempfile.TemporaryDirectory(prefix='xp3-adapter-',ignore_cleanup_errors=True);root=Path(temp.name)
    source=(repo/'scripts/prepare-xp2.py').read_text(encoding='utf-8-sig')
    context=dict(globals(),GAME=game,ROOT=root,root=root,DEST=dest,data=data,UnityPy=UnityPy,
                 fsb5=fsb5,lz4=lz4,lookup=lookup,__file__=str(repo/'scripts/prepare-xp2.py'))
    # Reviewed UnityFS reader and unchanged Utage serialized-grid reader.
    exec(compile(source[source.index('f=open(GAME/'):source.index('book_objects={}')],__file__+'[unity-reader]','exec'),context)
    env=context['env'];books={}
    for obj in env.objects:
        if obj.type.name!='MonoBehaviour':continue
        head=obj.parse_monobehaviour_head()
        if head.m_Name in ['mochimochi11th.book','Main.chapter']:books[head.m_Name]=obj
    if set(books)!= {'mochimochi11th.book','Main.chapter'}:raise ValueError('XP3 native scenario books were not found.')
    grids=context['read_book'](books['mochimochi11th.book'].get_raw_data())
    settings=context['read_book'](books['Main.chapter'].get_raw_data(),True)
    write_json(root/'grids.json',grids);write_json(root/'main-settings.json',settings)
    fp=fingerprint(root/'serialized/sharedassets0.assets')
    texts=[]
    for grid in grids:
        for row in grid['rows'][1:]:
            d=dict(zip(grid['rows'][0]['strings'],row['strings']))
            if not d.get('Text'):continue
            texts.append(dict(id=f"{grid['name']}|{row['rowIndex']}|Text",source=d['Text'],translation='',note='',status='draft',sourceHash=hashlib.sha256(d['Text'].encode()).hexdigest()))
    for grid in settings:
        kind=grid['name'].rsplit(':',1)[-1]
        fields={'SceneGallery':['Title'],'Character':['NameText'],'Sound':['Title']}.get(kind,[])
        for row in grid['rows'][1:]:
            d=dict(zip(grid['rows'][0]['strings'],row['strings']))
            for field in fields:
                if not d.get(field):continue
                texts.append(dict(id=f"setting:{grid['name']}|{row['rowIndex']}|{field}",source=d[field],translation='',note='',status='draft',sourceHash=hashlib.sha256(d[field].encode()).hexdigest()))
    translation=dict(type='story-translations',schemaVersion=2,gameFingerprint=fp,gameName='性癖讨论3',translations=texts)
    if args.catalog:
        translation=json.loads(args.catalog.read_text(encoding='utf-8-sig'))
        if translation.get('gameFingerprint')!=fp:raise ValueError('Catalog fingerprint differs from the selected XP3 game.')
        if len({x['id'] for x in translation['translations']})!=len(translation['translations']):raise ValueError('Duplicate catalog IDs.')
    context.update(grids=grids,setting_grids=settings,translation=translation)
    # ResourceManager and media byte ranges are the same Unity schema. No
    # image/audio/video payload is emitted: only offsets and codec setup tables.
    resource_source=source[source.index('node_map='):source.index("tr={x['id']:")]
    # fsb5 1.0 assumes one channel bit and consequently reads 6/8-channel
    # headers 16 bytes late. Native FSB5 uses two channel bits, followed by
    # 27 offset bits in 32-byte units. Unity supplies the authoritative channel
    # count. Keep the old reviewed parser only for metadata/codebook chunks.
    old_audio="sm=bank.samples[0];offset=bank.header.size+bank.header.sampleHeadersSize+bank.header.nameTableSize+sm.dataOffset"
    new_audio="sm=bank.samples[0];native_channels=t['m_Channels'];sample_header=struct.unpack_from('<Q',blob,bank.header.size)[0];sample_offset=((sample_header>>7)&((1<<27)-1))*32;data_base=bank.header.size+bank.header.sampleHeadersSize+bank.header.nameTableSize;offset=data_base+sample_offset;audio_data=blob[offset:data_base+bank.header.dataSize]"
    if resource_source.count(old_audio)!=1:raise ValueError('Reviewed FSB5 reader changed; recheck XP3 multichannel offsets.')
    resource_source=resource_source.replace(old_audio,new_audio).replace("item['size']=len(sm.data)","item['size']=len(audio_data)").replace('sm.channels','native_channels')
    exec(compile(resource_source,__file__+'[resource-index]','exec'),context)
    conversion=source[source.index("tr={x['id']:"):source.index("story=dict(type='story-player'")]
    exec(compile(conversion,__file__+'[scene-converter]','exec'),context)
    c=context;index=c['index'];scenes=c['scenes'];stats=c['stats']
    scenario_text_rows=sum(1 for g in grids for r in g['rows'][1:] if not r['isEmpty'] and not r['isCommentOut']
        and dict(zip(g['rows'][0]['strings'],r['strings'])).get('Text')
        and not dict(zip(g['rows'][0]['strings'],r['strings'])).get('Command','').startswith('//'))
    story=dict(type='story-player',schemaVersion=1,id='xp3-1-10',gameFingerprint=fp,title='性癖讨论3',
        stage=dict(width=1280,height=720),startScene=c['start'],assets=c['story_assets'],texts=list(c['texts'].values()),scenes=scenes,
        mapSize=dict(width=1320,height=max(s.get('map',{}).get('y',0) for s in scenes)+150),
        program=dict(version=1,entry=c['start'],variables={},nodes=c['nodes'],mapEntries=c['mapentries']),
        adapter=dict(mode='scene-and-branch-browser',sourceTextRows=scenario_text_rows,translationEntries=len(c['texts']),spokenDialogueRows=stats['spokenDialogueRows'],
                     nativeCommandTextFields=stats['nativeCommandTextFields'],description='独立续作适配；尚未汉化的条目显示原文。条件分支手动浏览；讨论小游戏为资料与继续入口。'))
    catalog_by_id={t['id']:t for t in translation['translations']}
    for entry in story['texts']:
        raw=catalog_by_id.get(entry['id'])
        if raw and raw.get('sourceHash'):entry['sourceHash']=raw['sourceHash']
        if raw and raw.get('speaker') and not entry.get('speaker'):entry['speaker']=raw['speaker']
    write_json(data/'story.json',story);write_json(data/'translations.json',translation)
    write_json(data/'asset-manifest.json',dict(type='story-player-asset-manifest',schemaVersion=1,storyId=story['id'],gameFingerprint=fp,assets=[]))
    write_json(data/'image-overrides.json',dict(type='xp2-image-overrides',schemaVersion=1,gameFingerprint=fp,images=[]))
    write_json(data/'player-config.json',dict(version='1.6.0',gameId='xp3',gameName='性癖讨论3',shortName='XP3',gameVersion='v1.10',translationPending=True,
        folderHint='性癖討論3_v1.10 或其中的 性癖討論3_Data',nativePresentation='data/native-presentation.json',chapterMap='data/chapter-map/manifest.json',
        story='data/story.json',translations='data/translations.json',support='data/support.json',assets='data/asset-manifest.json',defaultMode='player',reviewEnabled=False,
        localGame=True,unityIndex='data/unity-index.json',imageOverrides='data/image-overrides.json'))
    make_workbench_profile(context,game,root,books['mochimochi11th.book'],books['Main.chapter'])
    # UI parser is shared but only XP3 references are written to the website.
    subprocess.run([sys.executable,str(repo/'scripts/xp2-adapter/extract-native-ui.py'),'--serialized',str(root/'serialized'),'--game',str(game),
        '--output',str(root/'native-ui-inventory.json'),*(['--dependencies',str(args.dependencies)] if args.dependencies else [])],check=True,stdout=subprocess.DEVNULL)
    inventory=json.loads((root/'native-ui-inventory.json').read_text('utf-8'))
    recall_count,cg_count=native_shell(dest,settings,inventory)
    spec=importlib.util.spec_from_file_location('xp3_presentation',repo/'scripts/xp2-adapter/extract-native-presentation.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    presentation=module.extract(argparse.Namespace(story=data/'story.json',index=data/'unity-index.json',translations=data/'translations.json',analysis_dir=root,
        ui_inventory=root/'native-ui-inventory.json',output=data/'native-presentation.json'))
    presentation['evidence']={'assembly':'XP3 Assembly-CSharp.dll was read as type metadata only; no game assembly was executed.',
        'presentationSemantics':'Same authored Utage command columns and parameter names as XP2; source row anchors and XP3 layer/UI bindings verified.',
        'limitations':['Unity random shake uses a deterministic browser approximation.','Custom discussion game logic is represented by manual branch gates.']}
    presentation['nativeConfigCurves']['evidence']='XP3 native UI/config schema; shared Utage reading curves.'
    write_json(data/'native-presentation.json',presentation)
    subprocess.run(['node',str(repo/'scripts/xp2-adapter/build-chapter-maps.mjs'),str(data/'story.json'),str(data/'chapter-map')],check=True)
    map_directory=data/'chapter-map'
    map_manifest=json.loads((map_directory/'manifest.json').read_text('utf-8'))
    expected_maps={'manifest.json',*(chapter['file'] for chapter in map_manifest['chapters'])}
    for old in map_directory.glob('*.json'):
        if old.name not in expected_maps:old.unlink()
    html=(repo/'private/story-player/index.html').read_text('utf-8')
    html=html.replace('data-game-id="xp2"','data-game-id="xp3"').replace('性癖讨论2','性癖讨论3').replace('XP2','XP3').replace('RJ01049613','RJ01598673')
    html=html.replace('「性癖討論v1.0.0」或其中的「性癖討論2_Data」','「性癖討論3_v1.10」或其中的「性癖討論3_Data」')
    html=html.replace('即可使用内置中文翻译阅读。','即可阅读原文；完成汉化后可内置中文翻译。').replace('购买游戏本体后直接载入文件夹即可享受汉化版','购买游戏本体后直接载入文件夹即可开始阅读，中文翻译待汉化后更新')
    html=html.replace('载入，即可体验汉化版。','载入，即可阅读原文，汉化完成后将加入中文译文。').replace('配套中文译文随网站载入。','当前提供原文阅读；汉化完成后将在此内置中文译文。')
    (dest/'index.html').write_text(html,'utf-8')
    report=dict(type='xp3-adapter-report',schemaVersion=1,gameId='xp3',gameVersion='v1.10',gameFingerprint=fp,
        scenarioGrids=len(grids),activeScenarioRows=stats['rows'],catalogEntries=len(story['texts']),displayedDialogueCount=stats['spokenDialogueRows'],
        selections=stats['selections'],selectionLabelCount=stats['selectionLabelCount'],assets=len(story['assets']),indexedAssets=len(index['assets']),
        bundleBlocks=len(index['bundle']['blocks']),scenes=len(scenes),mapEntries=len(c['mapentries']),nativeRecalls=recall_count,nativeCgs=cg_count,
        textureFormats=dict(c['formats']),approximations=dict(c['approximations']),unresolved=dict(c['unresolved']),stats=dict(stats),
        translationPending=not any(t['translation'].strip() for t in translation['translations']),
        stableIds='Native grid.name|rowIndex|Text; setting:grid.name|rowIndex|field. Complete workbench catalog preserves auxiliary field IDs.',
        sourceBytesReadLocally=True,gameMediaCopied=False,nativeUiParseErrors=inventory['parseErrors'])
    write_json(data/'adapter-report.json',report,True)
    write_json(data/'support.json',dict(version='1.6.0',items=[
        dict(label='性癖讨论3 v1.10 专用适配，原版游戏目录只读读取',status='ready'),
        dict(label=f'保留 {len(story["texts"]):,} 项原文；翻译尚待汉化工作台完成',status='ready'),
        dict(label='独立回想、CG、原生界面与演出参数绑定',status='ready'),
        dict(label='条件与讨论结果由读者手动选择，未运行原游戏小游戏',status='partial'),
        dict(label='随机震动采用可重现近似；存档与解锁不参与浏览',status='partial')]))
    print(json.dumps({k:v for k,v in report.items() if k not in ['approximations','unresolved','stats','nativeUiParseErrors']},ensure_ascii=True))
    print('unresolved',json.dumps(report['unresolved'],ensure_ascii=True))
    context['f'].close()
    for stream in env.files.values():
        reader=getattr(stream,'reader',stream)
        if hasattr(reader,'dispose'):reader.dispose()
    if temp:temp.cleanup()


if __name__=='__main__': main()
