// Run: node build.cjs (Node.js required only for rebuilding, not for using the HTML.)
const fs=require('fs');const path=require('path');
const at=name=>path.join(__dirname,name);
const output=fs.readFileSync(at('template.html'),'utf8')
 .replace('/*__ASSETS__*/',fs.readFileSync(at('assets-data.js'),'utf8'))
 .replace('/*__RUNTIME__*/',fs.readFileSync(at('runtime.js'),'utf8'));
fs.writeFileSync(path.join(__dirname,'..','双击打开.html'),output);
console.log('已生成：双击打开.html');
