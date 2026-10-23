#!/usr/bin/env python3
"""Prepare the XP2 scene browser from a user's original Unity game and translation JSON.
Requires Python 3.11+, UnityPy==1.25.4, lz4==4.4.5 and fsb5==1.0.
The deployed website never runs this tool and never uploads the user's game.
Custom discussion minigames remain explicit manual browsing gates.
"""
import argparse,tempfile,pathlib,sys,json,struct,bisect,collections,io,hashlib,base64,zlib,re,copy,math
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--game',required=True,type=Path,help='Original game directory, or its *_Data directory')
p.add_argument('--translation',required=True,type=Path)
p.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'private/story-player')
a=p.parse_args();GAME=a.game.resolve()
if not GAME.name.endswith('_Data'):
 candidates=list(GAME.glob('*_Data'))
 if len(candidates)!=1:raise SystemExit('Select the original game folder with one *_Data directory.')
 GAME=candidates[0]
DEST=a.output.resolve();data=DEST/'data';data.mkdir(parents=True,exist_ok=True)
translation=json.loads(a.translation.read_text(encoding='utf-8-sig'))
if translation.get('type') not in ['xp2-translation','story-translations']:raise SystemExit('Unsupported translation document type.')
if len(translation.get('translations',[]))!=10173:raise SystemExit('This adapter targets the supplied XP2 1.0.0 translation corpus (10,173 entries).')
temp=tempfile.TemporaryDirectory(prefix='xp2-scene-adapter-',ignore_cleanup_errors=True);root=ROOT=Path(temp.name)
import lz4.block,UnityPy,fsb5
from fsb5.vorbis_headers import lookup
f=open(GAME/'data.unity3d','rb')
def z(f):
 b=bytearray()
 while True:
  c=f.read(1)
  if c==b'\0':return b.decode()
  b.extend(c)
def n(f,t):return struct.unpack('>'+t,f.read(struct.calcsize(t)))[0]
assert z(f)=='UnityFS';version=n(f,'I');print('ver',version,z(f),z(f));size=n(f,'q');cs=n(f,'I');us=n(f,'I');flags=n(f,'I');f.seek((f.tell()+15)&~15);start=f.tell()
if flags&128:f.seek(size-cs)
b=f.read(cs);b=lz4.block.decompress(b,uncompressed_size=us) if flags&63 in (2,3) else b
import io
r=io.BytesIO(b);r.seek(16);count=n(r,'i');blocks=[];co=start if flags&128 else start+cs
if flags&512:co=(co+15)&~15
uo=0
for _ in range(count):
 u=n(r,'I');c=n(r,'I');fl=n(r,'H');blocks.append(dict(compressedOffset=co,compressedSize=c,uncompressedOffset=uo,uncompressedSize=u,compression=fl&63));co+=c;uo+=u
nodes=[]
for _ in range(n(r,'i')):nodes.append(dict(offset=n(r,'q'),size=n(r,'q'),flags=n(r,'I'),path=z(r)))
print('blocks',len(blocks),'virtual',uo);print('nodes',nodes)
(root/'bundle-metadata.json').write_text(json.dumps(dict(size=size,blocks=blocks,nodes=nodes),separators=(',',':')),encoding='utf-8')
starts=[v['uncompressedOffset'] for v in blocks]
def read_range(offset,length):
 out=bytearray();i=max(0,bisect.bisect_right(starts,offset)-1)
 while length:
  block=blocks[i];f.seek(block['compressedOffset']);d=f.read(block['compressedSize']);d=lz4.block.decompress(d,uncompressed_size=block['uncompressedSize']) if block['compression'] in (2,3) else d
  at=offset-block['uncompressedOffset'];chunk=d[at:at+length];out.extend(chunk);offset+=len(chunk);length-=len(chunk);i+=1
 return bytes(out)
meta=root/'serialized';meta.mkdir(exist_ok=True)
for node in nodes:
 if node['size']<100*1024*1024:
  p=meta/pathlib.Path(node['path']).name
  if not p.exists():p.write_bytes(read_range(node['offset'],node['size']))
env=UnityPy.load(str(meta))


class R:
 def __init__(self,b):self.b=b;self.p=0
 def i(self):v=struct.unpack_from('<i',self.b,self.p)[0];self.p+=4;return v
 def s(self):
  n=self.i()
  if not 0<=n<1000000:raise ValueError('Invalid Unity book string length')
  v=self.b[self.p:self.p+n].decode('utf-8');self.p=(self.p+n+3)&~3;return v
 def arr(self,fn):return [fn() for _ in range(self.i())]
def read_book(blob,chapter=False):
 r=R(blob);r.p=28;name=r.s();version=r.i()
 if chapter:
  references=r.i();r.p+=references*12
 grids=[]
 for _ in range(r.i()):
  rows=[]
  for _ in range(r.i()):rows.append(dict(rowIndex=r.i(),strings=r.arr(r.s),isEmpty=r.i(),isCommentOut=r.i()))
  g=dict(rows=rows,name=r.s(),type=r.i(),textLength=r.i(),headerRow=r.i())
  if not chapter:g['entityIndexTbl']=r.arr(r.i);g['entityDataList']=r.arr(lambda:dict(originalStrings=r.arr(r.s)))
  grids.append(g)
 if r.p!=len(blob):raise ValueError('Unexpected Unity book schema or game version')
 return grids
book_objects={}
for o in env.objects:
 if o.type.name!='MonoBehaviour':continue
 try:
  head=o.parse_monobehaviour_head()
  if head.m_Name in ['mochimochi11th.book','Main.chapter']:book_objects[head.m_Name]=o.get_raw_data()
 except (ValueError,KeyError):pass
grids=read_book(book_objects['mochimochi11th.book']);setting_grids=read_book(book_objects['Main.chapter'],True)
node_map={Path(n['path']).name:n for n in nodes}
assets={};settings={};names={};formats=collections.Counter()
def location(source,offset,size):
 source=Path(source).name
 if source in node_map:return dict(file='data.unity3d',space='bundle',offset=node_map[source]['offset']+offset,size=size)
 return dict(file=source,space='file',offset=offset,size=size)
def bits(b,p,n):return sum(((b[(p+i)//8]>>((p+i)%8))&1)<<i for i in range(n))
def modeflags(setup):
 framing=max(i for i in range(len(setup)*8) if bits(setup,i,1))
 candidates=[]
 for count in range(1,65):
  p=framing-count*41-6
  if p<56 or bits(setup,p,6)!=count-1:continue
  modes=[];ok=True
  for j in range(count):
   q=p+6+j*41
   if bits(setup,q+1,16) or bits(setup,q+17,16):ok=False;break
   modes.append(bool(bits(setup,q,1)))
  if ok:candidates.append(modes)
 assert candidates
 return candidates[-1]
for o in env.objects:
 if o.type.name not in ['Texture2D','AudioClip','VideoClip']:continue
 t=o.read_typetree();name=t['m_Name'];prefix={'Texture2D':'texture','AudioClip':'audio','VideoClip':'video'}[o.type.name];id=f'{prefix}:{o.assets_file.name}:{o.path_id}'
 if prefix=='texture':
  st=t['m_StreamData'];payload=t['image data'];formats[t['m_TextureFormat']]+=1
  if st['size']:item=location(st['path'],st['offset'],st['size'])
  elif payload:
   raw=o.get_raw_data();relative=raw.find(bytes(payload));assert relative>=0
   item=location(o.assets_file.name,o.byte_start+relative,len(payload))
  else:continue
  item.update(kind=prefix,width=t['m_Width'],height=t['m_Height'],format=t['m_TextureFormat'],flipY=True)
 elif prefix=='audio':
  st=t['m_Resource'];item=location(st['m_Source'],st['m_Offset'],st['m_Size']);fp=open(GAME/st['m_Source'],'rb');fp.seek(st['m_Offset']);blob=fp.read(st['m_Size']);fp.close();bank=fsb5.FSB5(blob);assert len(bank.samples)==1
  sm=bank.samples[0];offset=bank.header.size+bank.header.sampleHeadersSize+bank.header.nameTableSize+sm.dataOffset
  item['offset']+=offset;item['size']=len(sm.data);item.update(kind='audio',frequency=sm.frequency,channels=sm.channels,samples=sm.samples,packetOffset=0,duration=t['m_Length'])
  if bank.header.mode==fsb5.SoundFormat.VORBIS:
   crc=sm.metadata[fsb5.MetadataChunkType.VORBISDATA].crc32;key=str(crc);item.update(codec='fsb5-vorbis',vorbisSetup=key)
   if key not in settings:
    import re
    code=(Path(__file__).resolve().parent/'xp2-adapter/vorbis_codebooks_fsb.h').read_text(encoding='utf-8')
    match=re.search(r'static const uint8_t vcb_'+format(crc,'08x')+r'\[\] = \{(.*?)\};',code,re.S)
    assert match,crc
    setup=bytes(int(x,16) for x in re.findall(r'0x([0-9a-fA-F]{2})',match.group(1)));assert zlib.crc32(setup)==crc
    quality,ch,rate=lookup.get(crc,(None,sm.channels,sm.frequency));bs,bl=256,2048
    settings[key]=dict(setupBase64=base64.b64encode(setup).decode(),blockSizes=[bs,bl],modeBlockFlags=modeflags(setup),quality=quality,channels=ch,frequency=rate)
  else:item.update(codec='pcm',bits={fsb5.SoundFormat.PCM8:8,fsb5.SoundFormat.PCM16:16,fsb5.SoundFormat.PCM32:32}[bank.header.mode])
 else:
  st=t['m_ExternalResources'];item=location(st['m_Source'],st['m_Offset'],st['m_Size']);item.update(kind='video',codec='mp4',width=t['Width'],height=t['Height'],duration=t['m_FrameCount']/t['m_FrameRate'])
 item['name']=name;assets[id]=item;names.setdefault(prefix,{}) .setdefault(name,[]).append(id)
# Use Unity's actual Resources paths. A basename is not an asset identity:
# texture/event/foo and texture/thumbnail/foo deliberately share m_Name.
resource_paths={}
for o in env.objects:
 if o.type.name!='ResourceManager':continue
 for path,ptr in o.read().m_Container:
  if not ptr.m_PathID:continue
  obj=ptr.deref();kind={'Texture2D':'texture','AudioClip':'audio','VideoClip':'video'}.get(obj.type.name)
  if not kind:continue
  asset=f'{kind}:{obj.assets_file.name}:{obj.path_id}'
  if asset not in assets:continue
  path=path.replace('\\','/').lower();resource_paths.setdefault(path,[]).append(asset)
  assets[asset].setdefault('resourcePaths',[]).append(path)
files=[]
for path in ['data.unity3d','resources.resource','sharedassets0.resource']:
 size=(GAME/path).stat().st_size;samples=[]
 with open(GAME/path,'rb') as fp:
  for offset in sorted(set([0,max(0,size//2-32768),max(0,size-65536)])):
   fp.seek(offset);sample_data=fp.read(min(65536,size-offset));samples.append(dict(offset=offset,length=len(sample_data),sha256=hashlib.sha256(sample_data).hexdigest()))
 files.append(dict(path=path,size=size,samples=samples))
fingerprint=translation['gameFingerprint']
index=dict(type='xp2-unity-local-index',schemaVersion=1,gameFingerprint=fingerprint,files=files,bundle=dict(file='data.unity3d',blocks=blocks),assets=assets,vorbisSetups=settings,names=names,resourcePaths=resource_paths)
(data/'unity-index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
tr={x['id']:x for x in translation['translations']};texts={id:dict(id=id,source=x['source']) for id,x in tr.items()};assets=index['assets'];texture={};characters={};layers={};sounds={};stats=collections.Counter();unresolved=collections.Counter();approximations=collections.Counter();used=set()
def num(x,default=0):
 try:return float(x) if x else default
 except:return default
def rowdict(g,r):return dict(zip(g['rows'][0]['strings'],r['strings']))
def media(name,kind,category=None,subfile=None):
 if not name:return None
 path=name.replace('\\','/').strip('/');stem=path.rsplit('.',1)[0] if '.' in path.rsplit('/',1)[-1] else path
 prefix={'texture':'texture','audio':'sound','video':'video'}[kind]
 native='/'.join(x for x in [prefix,category,stem] if x).lower()
 ids=resource_paths.get(native,[])
 # Explicit sub-sprite requests must never silently display the atlas. This
 # game's settings have no SubFileName cells; preserve that fact on regeneration.
 if subfile:raise ValueError('SubFileName requires a sprite crop adapter: '+native+'#'+subfile)
 if not ids:
  # Only accept an unambiguous full resource. Never guess among duplicate names
  # or use a gallery thumbnail as a substitute for an unresolved event texture.
  candidates=[id for id,a in assets.items() if a['kind']==kind and a['name'].lower()==stem.rsplit('/',1)[-1].lower() and not any('/thumbnail/' in p for p in a.get('resourcePaths',[]))]
  if len(candidates)==1:ids=candidates
 if len(ids)!=1:return None
 id=ids[0];used.add(id);return id
for g in setting_grids:
 kind=g['name'].split(':')[-1]
 for r in g['rows'][1:]:
  if r['isEmpty'] or r['isCommentOut']:continue
  d=rowdict(g,r)
  if kind=='Texture' and d.get('Label'):texture[d['Label']]=d
  elif kind=='Character' and d.get('CharacterName'):characters[(d['CharacterName'],d.get('Pattern',''))]=d
  elif kind=='Layer' and d.get('LayerName'):layers[d['LayerName']]=d
  elif kind=='Sound' and d.get('Label'):sounds[d['Label']]=d
for (name,pattern),d in list(characters.items()):
 if (name,'') not in characters:characters[(name,'')]=d
for gg in grids:
 hdr=gg['rows'][0]['strings']
 for r in gg['rows'][1:]:
  d=dict(zip(hdr,r['strings']));id=f"{gg['name']}|{r['rowIndex']}|Text"
  if id in texts:
   assert texts[id]['source']==d.get('Text','');char=characters.get((d.get('Arg1',''),d.get('Arg2',''))) or characters.get((d.get('Arg1',''),''))
   if char:texts[id]['speaker']=char.get('NameText') or d.get('Arg1','')
default_layers={kind:next((name for name,d in layers.items() if d.get('Type')==kind),None) for kind in ['Bg','Character','Sprite']}
blank=media('2560_black','texture','bg')
scenes=[];nodes={};mapentries={};allrows={};chapter_first={};labelmap={};nextmap={};if_false={};branch_end={};segments=[];seg_at={};pagecounts=collections.Counter();mapped_texts=set()
CONTROL={'If','ElseIf','Else','EndIf','Jump','Selection','PauseScenario','StartDiscussionSystem','StartSpecialTalk','StartClaimArgument','StartCollectObservations','EndScenario','EndSceneGallery'}
for gi,g in enumerate(grids):
 rows=[]
 for r in g['rows'][1:]:
  if r['isEmpty'] or r['isCommentOut']:continue
  d=rowdict(g,r);d['_row']=r['rowIndex'];d['_id']=f"{g['name']}|{r['rowIndex']}|Text";d['_cmd']=d.get('Command','')
  if d['_cmd'].startswith('//'):continue
  rows.append(d)
 allrows[gi]=rows
 cuts={0,len(rows)}
 for i,d in enumerate(rows):
  if d['_cmd'] in CONTROL or d['_cmd'].startswith('*'):cuts.update([i,i+1])
 cuts=sorted(cuts);first=None
 for a,b in zip(cuts,cuts[1:]):
  if a==b:continue
  sid=f'chapter-{gi+1:02d}-row-{rows[a]["_row"]}';seg=dict(id=sid,gi=gi,a=a,b=b,rows=rows[a:b],g=g);segments.append(seg)
  if first is None:first=sid;chapter_first[gi]=sid
  for i in range(a,b):seg_at[(gi,i)]=sid
 for i,d in enumerate(rows):
  if d['_cmd'].startswith('*'):labelmap[(gi,d['_cmd'])]=seg_at[(gi,i)]
 if first:
  key=g['name'].split(':')[-1];labelmap[(None,key)]=first;labelmap[(None,'*'+key)]=first;labelmap[(None,key.split('@')[0])]=first
 # Structured alternatives are exposed as explicit manual browsing gates.
 stack=[]
 for i,d in enumerate(rows):
  c=d['_cmd']
  if c=='If':stack.append([i])
  elif c in ['ElseIf','Else'] and stack:stack[-1].append(i)
  elif c=='EndIf' and stack:
   chain=stack.pop()
   for k,j in enumerate(chain):
    if_false[(gi,j)]=chain[k+1] if k+1<len(chain) else i+1
    if k>0:branch_end[(gi,j)]=i+1
for i,seg in enumerate(segments):
 gi=seg['gi'];nextmap[seg['id']]=seg_at.get((gi,seg['b']))
def go(sid):return dict(type='goto',target=sid) if sid else dict(type='end')
def target(gi,label):return labelmap.get((gi,label)) or labelmap.get((None,label)) or labelmap.get((None,label.lstrip('*')))
def at(gi,i):return seg_at.get((gi,i))
def default_entry():return dict(background=dict(asset=blank),characters=[],eventMode=False,dialogue=dict(textId=None,visible=False))
state_by_chapter={};supported={'','Wait','Bg','BgOff','BgEvent','BgEventOff','CharacterOff','Sprite','SpriteOff','Bgm','Se','StopBgm','StopSe','Video','Tween','Shake','GuiActive','Param','SelectionClick','ChangeSkip','DebugLog','ShowHearts','HideHearts','AddHeart','LossHeart','ShowConsiderResult','HideConsiderResult','ShowClaimArgumentAgenda','HideClaimArgumentAgenda','FinishSpecialTalk','EndDiscussionSystem','HideConsiderResult'}
def entry_for(state):
 # Runtime reconstructs a valid graph path for direct jumps. Spreadsheet order
 # crosses alternatives that were never taken and cannot supply entry snapshots.
 return default_entry()
def add_event(scene,event_type,**payload):
 e=dict(type=event_type,at=scene['_clock'],**payload);scene['events'].append(e);scene['commands'].append(dict(type='dialogue' if event_type=='dialogue' else 'event',eventIndex=len(scene['events'])-1));return scene['commands'][-1]
def actor(scene,state,id,asset,layer=None,params=None,x=None,y=None,scale=None,kind='character'):
 if not asset:return
 md=assets[asset];params=params or {};ly=layers.get(layer or '',{});factor=num(params.get('Scale'),1)*(scale if scale is not None else 1);w=md['width']*factor;h=md['height']*factor
 xx=640+num(ly.get('X'))+num(params.get('X'))+(x or 0)-w/2;yy=360-num(ly.get('Y'))-num(params.get('Y'))-(y or 0)-h/2
 patch=dict(id=id,asset=asset,x=xx,y=yy,width=w,height=h,layer=num(ly.get('Order'),10),layerName=layer or '',kind=kind,flip=str(ly.get('FlipX','')).lower()=='true',opacity=1)
 state['actors'][id]=patch;add_event(scene,'character',**patch)
def remove(scene,state,id):
 if id in state['actors']:add_event(scene,'character',id=id,remove=True);del state['actors'][id]
for seg in segments:
 gi=seg['gi'];g=seg['g'];sid=seg['id'];first=chapter_first[gi];state=state_by_chapter.setdefault(gi,dict(actors={},lastchar={},bg={}))
 chapter=g['name'].split(':')[-1];scene=dict(id=sid,title=chapter if sid==first else f'{chapter} · {seg["rows"][0]["_row"]}',chapter=f'剧情 {gi+1:02d}',subtitle='场景资源浏览 · 条件与讨论结果由读者选择',mapGroup=first,duration=1,entry=entry_for(state),events=[],commands=[],_clock=0)
 if sid==first:scene['map']=dict(x=160+(gi%4)*300,y=70+(gi//4)*140);mapentries[first]=dict(node=sid)
 exit=go(nextmap[sid]);cfirst=seg['rows'][0]['_cmd'];pos=seg['a']
 if cfirst in ['If','ElseIf']:
  false=at(gi,if_false.get((gi,pos),seg['b']));expr=seg['rows'][0].get('Arg1','条件')
  exit=dict(type='choices',items=[dict(id=sid+'-true',label='条件分支浏览：成立 · '+expr[:100],then=go(nextmap[sid])),dict(id=sid+'-false',label='条件分支浏览：不成立 · '+expr[:100],then=go(false))]);stats['manualConditionalGates']+=1
 elif cfirst in ['Else','EndIf']:pass
 elif cfirst=='Jump':
  d=seg['rows'][0];to=target(gi,d.get('Arg1',''))
  if not to:unresolved['Jump:'+d.get('Arg1','')]+=1;exit=dict(type='choices',items=[dict(id=sid+'-missing',label='此跳转由原游戏交互处理；结束本段浏览',then=dict(type='end'))])
  elif d.get('Arg2'):exit=dict(type='choices',items=[dict(id=sid+'-jump',label='跳转分支浏览：'+d.get('Arg2','')[:100],then=go(to)),dict(id=sid+'-continue',label='继续当前脚本',then=go(nextmap[sid]))])
  else:exit=go(to)
 elif cfirst=='Selection':
  if pos>0 and allrows[gi][pos-1]['_cmd']=='Selection':exit=go(nextmap[sid])
  else:
   opts=[];j=pos
   while j<len(allrows[gi]) and allrows[gi][j]['_cmd']=='Selection':
    d=allrows[gi][j];id=d['_id'];to=target(gi,d.get('Arg1',''));label=tr.get(id,{}).get('translation') or d.get('Text') or d.get('Arg1') or f'选项 {len(opts)+1}';opts.append(dict(id=id if id in texts else sid+str(j),label=label[:500],then=go(to)));j+=1
    if id in texts:mapped_texts.add(id);stats['selectionLabelCount']+=1
   exit=dict(type='choices',items=opts);stats['selections']+=1
 elif cfirst in ['EndScenario','EndSceneGallery']:exit=dict(type='end')
 elif cfirst in CONTROL:
  exit=dict(type='choices',items=[dict(id=sid+'-continue',label='继续浏览脚本（原游戏讨论交互未运行）',then=go(nextmap[sid]))]);stats['customInteractionGates']+=1
 # A completed true branch jumps over all later alternatives.
 if seg['b']<len(allrows[gi]) and allrows[gi][seg['b']]['_cmd'] in ['ElseIf','Else']:
  end=branch_end.get((gi,seg['b']))
  if end is not None and cfirst not in ['If','ElseIf']:exit=go(at(gi,end))
 for d in seg['rows']:
  c=d['_cmd'];stats['rows']+=1
  if c in CONTROL or c.startswith('*'):continue
  a=d.get('Arg1','');b=d.get('Arg2','');ly=d.get('Arg3','');amount=num(d.get('Arg6'))
  if c in ['Bg','BgEvent','Sprite']:
   label=(b or a) if c=='Sprite' else a
   p=texture.get(label,{});asset=media(p.get('FileName') or label,'texture',p.get('Type','Sprite' if c=='Sprite' else 'Bg').lower(),p.get('SubFileName'))
   layer=ly or default_layers['Sprite' if c=='Sprite' else 'Bg']
   if c in ['Bg','BgEvent']:add_event(scene,'mode',eventMode=c=='BgEvent')
   if asset:
    id='sprite:'+a if c=='Sprite' else 'bg:'+layer
    actor(scene,state,id,asset,layer,p,x=num(d.get('Arg4')),y=num(d.get('Arg5')),kind='sprite' if c=='Sprite' else 'background');state['bg'][a]=id
   else:unresolved[c+':'+a]+=1
  elif c in ['BgOff','BgEventOff','SpriteOff']:
   kind='sprite' if c=='SpriteOff' else 'background';filters={}
   if c=='SpriteOff' and a not in ['', 'AllSpriteLayers','AllSpriteObjects']:
    filters={'layerName':a} if a in layers else {'id':'sprite:'+a}
   add_event(scene,'clearActors',kind=kind,**filters)
   for id,item in list(state['actors'].items()):
    if item.get('kind')==kind and all(item.get(k)==v for k,v in filters.items()):del state['actors'][id]
  elif c=='CharacterOff':
   filters={} if not a or a in ['All','AllCharacterLayers','AllCharacterObjects'] else ({'layerName':a} if a in layers else {'id':'char:'+a})
   add_event(scene,'clearActors',kind='character',**filters)
   for id,item in list(state['actors'].items()):
    if item.get('kind')=='character' and all(item.get(k)==v for k,v in filters.items()):del state['actors'][id]
  elif c=='' and a:
   p=characters.get((a,b)) or characters.get((a,''));asset=media(p.get('FileName') if p else b,'texture','character',p.get('SubFileName') if p else None)
   if asset:actor(scene,state,'char:'+a,asset,ly or default_layers['Character'],p,x=num(d.get('Arg4')),y=num(d.get('Arg5')))
   elif p:unresolved['Character:'+a+':'+b]+=1
  elif c in ['Bgm','Se']:
   p=sounds.get(a,{});asset=media(p.get('FileName') or a,'audio',p.get('Type',c).lower())
   if asset:add_event(scene,'audio',id='bgm' if c=='Bgm' else 'se',asset=asset,loop=c=='Bgm',volume=max(0,min(1,num(p.get('Volume'),1))),duration=max(.01,assets[asset].get('duration',1)))
   else:unresolved[c+':'+a]+=1
  elif c in ['StopBgm','StopSe']:add_event(scene,'stopAudio',id='bgm' if c=='StopBgm' else 'se',duration=max(0,min(20,num(d.get('Arg1')))))
  elif c=='Video':
   asset=media(a,'video')
   if asset:add_event(scene,'video',id='video',asset=asset,width=1280,height=720,x=0,y=0,loop=False,duration=assets[asset]['duration'])
   else:unresolved['Video:'+a]+=1
  elif c=='Wait':
   wait=num(d.get('Arg6'),num(a));wait=max(0,min(60,wait))
   if wait:scene['commands'].append(dict(type='wait',duration=wait));scene['_clock']+=wait
  elif c=='Shake':
   p=dict(re.findall(r'([a-zA-Z]+)=([-+.0-9]+)',ly or b));duration=max(.01,min(10,num(p.get('time'),.3)));add_event(scene,'camera',shake=dict(amplitude=min(60,max(abs(num(p.get('x'),3)),abs(num(p.get('y'),3)))),frequency=20,duration=duration));approximations['Shake (camera substitute)']+=1
  elif c=='Tween':
   p=dict(re.findall(r'([a-zA-Z]+)=([-+.0-9]+)',ly or b));id='char:'+a if 'char:'+a in state['actors'] else state['bg'].get(a) or ('sprite:'+a if 'sprite:'+a in state['actors'] else None)
   if id and p:
    to={};old=state['actors'][id]
    for field in ['x','y','rotation','opacity','scaleX','scaleY']:
     raw=p.get(field) or p.get(field.lower())
     if raw is not None:to[field]=num(raw)
    if 'x' in to:to['x']=640+to['x']-old['width']/2
    if 'y' in to:to['y']=360-to['y']-old['height']/2
    if to:
     duration=max(0,min(30,num(p.get('time'),amount or .3)));add_event(scene,'tween',target='character:'+id,to=to,duration=duration,easing='linear');old.update(to)
    else:approximations['Tween no supported property']+=1
   else:approximations['Tween unsupported target/preset']+=1
  elif c in ['GuiActive']:approximations[c]+=1
  elif c and c not in supported:approximations[c]+=1
  if c=='Param':approximations['Param manual branch context']+=1
  id=d['_id']
  if c and d.get('Text') and id in texts:stats['nativeCommandTextFields']+=1
  if c=='' and d.get('Text') and id in texts:
   stats['spokenDialogueRows']+=1
   command=add_event(scene,'dialogue',textId=id);pc=d.get('PageCtrl','') or 'InputBrPage';pc={'0':'InputBrPage','2':'Next','3':'Input','4':'Br','5':'InputBr','6':'BrPage'}.get(pc,pc)
   if pc not in ['InputBrPage','Next','Input','Br','InputBr','BrPage']:approximations['PageCtrl '+pc]+=1;pc='InputBrPage'
   command['pageCtrl']=pc;pagecounts[pc]+=1;mapped_texts.add(id)
 # Limit arbitrary auto-advancing actor-only clips to explicit click gates where useful.
 duration=max([1,scene['_clock']]+[e['at']+e.get('duration',e.get('shake',{}).get('duration',0)) for e in scene['events']])+.01;scene['duration']=duration;del scene['_clock'];scenes.append(scene);nodes[sid]=dict(sceneId=sid,entryMode='carry',exit=exit)
# Translation-only original UI and discussion fields are available as explicitly labeled reference pages.
extras=collections.defaultdict(list)
for id in texts:
 if id not in mapped_texts:extras[id.rsplit('|',1)[0]].append(id)
archive_index=0
for group,ids in extras.items():
 if all(id.endswith('|Text') for id in ids):continue
 archive_index+=1;first=f'archive-{archive_index}-0';chunks=[ids[i:i+40] for i in range(0,len(ids),40)]
 for pi,chunk in enumerate(chunks):
  sid=f'archive-{archive_index}-{pi}';events=[dict(type='dialogue',at=0,textId=id) for id in chunk];commands=[dict(type='dialogue',eventIndex=i,pageCtrl='InputBrPage') for i in range(len(chunk))]
  scene=dict(id=sid,title=f'讨论与界面译文资料 {archive_index:02d}' if pi==0 else f'译文资料 {archive_index:02d} · {pi+1}',chapter='资料浏览',subtitle='原游戏界面与讨论字段译文档案；按资料顺序浏览，不执行小游戏',mapGroup=first,duration=1,entry=default_entry(),events=events,commands=commands)
  if pi==0:scene['map']=dict(x=160+(archive_index%4)*300,y=2200+(archive_index//4)*140);mapentries[first]=dict(node=sid)
  scenes.append(scene);nodes[sid]=dict(sceneId=sid,entryMode='reset',exit=go(f'archive-{archive_index}-{pi+1}' if pi+1<len(chunks) else None));mapped_texts.update(chunk)
# Main story opens on its original Start entry rather than promotional/book utility scenes.
start=next((chapter_first[i] for i,g in enumerate(grids) if g['name'].split(':')[-1]=='Start'),chapter_first[0]);story_assets=[]
for id in sorted(used):story_assets.append(dict(id=id,type={'texture':'image','audio':'audio','video':'video'}[assets[id]['kind']],src='local-assets/'+re.sub('[^a-zA-Z0-9_-]','_',id)+({'texture':'.png','audio':'.ogg','video':'.mp4'}[assets[id]['kind']])))
story=dict(type='story-player',schemaVersion=1,id='xp2-1-0-0',gameFingerprint=translation['gameFingerprint'],title='XP2 · 场景播放器',stage=dict(width=1280,height=720),startScene=start,assets=story_assets,texts=list(texts.values()),scenes=scenes,mapSize=dict(width=1320,height=max(s.get('map',{}).get('y',0) for s in scenes)+150),program=dict(version=1,entry=start,variables={},nodes=nodes,mapEntries=mapentries),adapter=dict(mode='scene-and-branch-browser',sourceTextRows=6670,translationEntries=len(texts),spokenDialogueRows=stats['spokenDialogueRows'],nativeCommandTextFields=stats['nativeCommandTextFields'],description='条件分支手动浏览；讨论小游戏不运行，界面和讨论译文在资料节点查阅。'))
translation.update(type='story-translations',schemaVersion=2,gameName=story['title']);jsonopts=dict(ensure_ascii=False,separators=(',',':'))
(data/'story.json').write_text(json.dumps(story,**jsonopts),encoding='utf-8');(data/'translations.json').write_text(json.dumps(translation,**jsonopts),encoding='utf-8')
manifest=dict(type='story-player-asset-manifest',schemaVersion=1,storyId=story['id'],gameFingerprint=story['gameFingerprint'],assets=[])
(data/'asset-manifest.json').write_text(json.dumps(manifest,**jsonopts),encoding='utf-8')
config=dict(version='1.2.0',chapterMap='data/chapter-map/manifest.json',story='data/story.json',translations='data/translations.json',support='data/support.json',assets='data/asset-manifest.json',defaultMode='player',reviewEnabled=False,localGame=True,unityIndex='data/unity-index.json')
(data/'player-config.json').write_text(json.dumps(config,**jsonopts),encoding='utf-8')
report=dict(type='xp2-adapter-report',schemaVersion=1,scenarioGrids=len(grids),exactScenarioTextFields=6670,displayedDialogueCount=stats['spokenDialogueRows'],selectionLabelCount=stats['selectionLabelCount'],nativeCommandTextFields=stats['nativeCommandTextFields'],preservedTranslationEntries=len(texts),catalogMatchedTranslations=len(texts),accessibleTextEntries=len(mapped_texts),assets=len(story_assets),scenes=len(scenes),mapEntries=len(mapentries),stats=stats,approximations=approximations,unresolved=dict(unresolved),scope='Scene resource/translated dialogue and manual branch browsing. Native custom discussion minigames are reference texts and explicit continuation gates; variables are not evaluated.',sourceBytesReadLocally=True,commandTextHandling='Only blank Command rows become dialogue. Selection Text becomes choice labels. Text fields on Bg, BgEvent, BgOff, DebugLog and Wait remain in the source translation catalog but never become spoken dialogue.')
report.update(declaredMapEntries=len(mapentries),storyChapterEntries=len(chapter_first),visibleMapNodes=len(scenes),storyMapNodes=len(segments),referenceMapNodes=len(scenes)-len(segments),mapEntriesRole='Legacy chapter and reference-group entry anchors. The visible graph contains every story segment and reference page, including intermediate branch/control nodes.',visualRepairs=dict(stage=dict(width=1280,height=720),resourceBinding='Native Unity ResourceManager path, including Texture Type folder; thumbnails excluded from story resources.',backgroundSlots='One fixed graphic slot per resolved native Bg layer, preserving explicitly separate layers.',eventMode='BgEvent hides ordinary characters until Bg. Mode and clears are evaluated dynamically across actual graph traversal.',jumpEntries='Neutral baked entries; runtime reconstructs a canonical valid graph route or restores the visited route state, never accumulates spreadsheet alternatives.',spriteBinding='Sprite Arg1 is object identity; Arg2 optionally supplies its texture label.'))
(data/'adapter-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
support=dict(version='1.0.0',items=[dict(label='原版 Unity 游戏目录只读读取，资源保留本机',status='ready'),dict(label='保留全部 10,173 项原文译文；场景显示 5,614 行对白和 35 个选项标签',status='ready'),dict(label='条件分支采用明确的手动浏览选项，不计算原游戏变量',status='partial'),dict(label='讨论小游戏未移植；对应译文可在资料节点查阅',status='partial'),dict(label='部分原生动画与窗口特效采用二维近似，请见部署说明',status='partial')]);(data/'support.json').write_text(json.dumps(support,**jsonopts),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k not in ['unresolved','approximations']},ensure_ascii=True));print('unresolved',len(unresolved),sum(unresolved.values()),'approximations',dict(approximations))

f.close()
for stream in env.files.values():
 reader=getattr(stream,'reader',stream)
 if hasattr(reader,'dispose'):reader.dispose()
temp.cleanup()
