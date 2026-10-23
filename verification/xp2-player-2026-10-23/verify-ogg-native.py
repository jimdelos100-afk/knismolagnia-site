"""Independent native decoding of temporary Ogg test files; keeps no media."""
from pathlib import Path
import sys,json,os
manifest=Path(sys.argv[1])
if len(sys.argv)>2 and sys.argv[2]:
 deps=Path(sys.argv[2]);sys.path.insert(0,str(deps))
 if os.name=='nt' and (deps/'pyogg').is_dir():
  dll_directory=os.add_dll_directory(str(deps/'pyogg'))
  os.environ['PATH']=str(deps/'pyogg')+os.pathsep+os.environ['PATH']
import pyogg
items=json.loads(manifest.read_text(encoding='utf-8'))
for item in items:
 decoded=pyogg.VorbisFile(str(manifest.parent/item['filename']))
 assert decoded.channels==item['channels']
 assert decoded.frequency==item['frequency']
 assert decoded.buffer_length//(2*decoded.channels)==item['samples']
print(json.dumps(dict(decodedSetups=len(items),exactSampleCount=len(items))))
