#!/usr/bin/env python3
"""Read native XP2 Unity UI components and sprite references without running Unity.

Requires UnityPy and its optional TypeTreeGeneratorAPI in the Python environment,
or supplied via --dependencies. The result is source metadata, not game media.
"""
import sys,pathlib,json,collections,argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--serialized',required=True,type=pathlib.Path)
parser.add_argument('--game',required=True,type=pathlib.Path)
parser.add_argument('--dependencies',type=pathlib.Path)
parser.add_argument('--output',required=True,type=pathlib.Path)
args=parser.parse_args()
if args.dependencies:sys.path.insert(0,str(args.dependencies.resolve()))
import UnityPy
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator
from UnityPy.classes.PPtr import PPtr
env=UnityPy.load(str(args.serialized))
gen=TypeTreeGenerator('2022.3.0f1')
game=args.game
if not game.name.endswith('_Data'):
    data_dirs=list(game.glob('*_Data'))
    if len(data_dirs)!=1:raise ValueError('Expected exactly one native game Data directory.')
    game=data_dirs[0]
gen.load_local_dll_folder(str(game/'Managed'))
env.typetree_generator=gen
def ref(o,p):
 if not p or not p.get('m_PathID'):return None
 try:
  x=PPtr(m_FileID=p['m_FileID'],m_PathID=p['m_PathID'],assetsfile=o.assets_file).deref()
  return x
 except:return None
def key(o):return f'{o.assets_file.name}:{o.path_id}'
gos={};rects={};sprites={};components=[];errors=[]
for o in env.objects:
 if o.type.name=='GameObject':
  t=o.read_typetree();gos[key(o)]={'name':t['m_Name'],'active':bool(t.get('m_IsActive'))}
 if o.type.name in ['RectTransform','Transform']:
  t=o.read_typetree();go=ref(o,t['m_GameObject']);par=ref(o,t.get('m_Father'));pgo=ref(par,par.read_typetree()['m_GameObject']) if par else None
  rects[key(go)]={'parent':key(pgo) if pgo else None,'transformId':key(o),**{k:v for k,v in t.items() if k not in ['m_GameObject','m_Father','m_Children','m_CorrespondingSourceObject','m_PrefabInstance','m_PrefabAsset']}}
 if o.type.name=='Sprite':
  t=o.read_typetree();tex=ref(o,t.get('m_RD',{}).get('texture'));sprites[key(o)]={'name':t['m_Name'],'rect':t.get('m_Rect'),'texture':('texture:'+key(tex)) if tex else None,'textureRect':t.get('m_RD',{}).get('textureRect'),'textureRectOffset':t.get('m_RD',{}).get('textureRectOffset'),'border':t.get('m_Border'),'pivot':t.get('m_Pivot')}
for o in env.objects:
 if o.type.name!='MonoBehaviour' or o.assets_file.name!='level0':continue
 try:
  h=o.parse_monobehaviour_head();cl=h.m_Script.read_typetree()['m_ClassName'];t=o.read_typetree();go=ref(o,{'m_FileID':h.m_GameObject.m_FileID,'m_PathID':h.m_GameObject.m_PathID})
  if cl in ['Image','RawImage','Text','Button','Toggle','Slider','CanvasScaler','UguiNovelText','AdvUguiMessageWindow','ExUguiTitle','UtageUguiConfig','AdvUguiMessageWindowManager','AdvEffectManager','AdvConfig','AdvCharacterGrayOutController','UguiButtonSe','AdvUguiLoadGraphicFile']:
   item={'id':key(o),'class':cl,'gameObject':key(go), 'data':{k:v for k,v in t.items() if k not in ['m_Script','m_Name','m_GameObject']}}
   if cl=='Image':
    spr=ref(o,t.get('m_Sprite'));item['sprite']=key(spr) if spr else None
   if cl=='RawImage':
    tex=ref(o,t.get('m_Texture'));item['texture']='texture:'+key(tex) if tex else None
   components.append(item)
 except Exception as ex:errors.append({'id':key(o),'error':str(ex)[:200]})
def path(k,seen=None):
 seen=seen or set()
 if k in seen:return '?cycle'
 seen.add(k);par=rects.get(k,{}).get('parent');return (path(par,seen)+'/' if par else '')+gos.get(k,{}).get('name',k)
for k,g in gos.items():g['path']=path(k)
out={'type':'xp2-native-ui-inventory','gameObjects':gos,'rectTransforms':rects,'sprites':sprites,'components':components,'parseErrors':errors}
dest=args.output;dest.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(json.dumps({'path':str(dest),'gameObjects':len(gos),'sprites':len(sprites),'components':len(components),'errors':len(errors)}))
for c in components:
 s=sprites.get(c.get('sprite'),{});p=gos.get(c['gameObject'],{}).get('path','')
 if s.get('texture')=='texture:sharedassets0.assets:1062' or c['class'] in ['AdvUguiMessageWindow','ExUguiTitle']:
  print(json.dumps({'component':c,'path':p,'rect':rects.get(c['gameObject']),'sprite':s},ensure_ascii=True))
