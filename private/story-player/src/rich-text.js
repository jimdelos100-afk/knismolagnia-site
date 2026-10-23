// A deliberately small safe subset of rich-text markup. Unknown tags stay visible.
// Imported text is never parsed as HTML or executed as script.
export function countRichText(value){
  const probe=document.createElement('div');renderRichText(probe,value);
  const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
  return segmenter?[...segmenter.segment(probe.textContent)].length:Array.from(probe.textContent).length;
}
export function renderRichText(container,value,{visibleCharacters=Infinity}={}){
  const text=String(value??''),root=document.createDocumentFragment(),stack=[{name:'root',node:root}];
  const pattern=/<\/?(?:b|i|u|color|size)(?:=[^<>]*)?>|<br\s*\/?>|\n/gi;
  const append=value=>stack.at(-1).node.append(document.createTextNode(value));
  let cursor=0;
  for(const match of text.matchAll(pattern)){
    append(text.slice(cursor,match.index));cursor=match.index+match[0].length;
    const token=match[0];
    if(token==='\n'||/^<br/i.test(token)){stack.at(-1).node.append(document.createElement('br'));continue;}
    const parsed=/^<(\/)?(b|i|u|color|size)(?:=([^<>]*))?>$/i.exec(token),name=parsed[2].toLowerCase();
    if(parsed[1]){
      if(stack.length>1&&stack.at(-1).name===name)stack.pop();else append(token);
      continue;
    }
    const node=document.createElement(name==='b'?'strong':name==='i'?'em':name==='u'?'u':'span');
    if(name==='color'){
      const color=(parsed[3]||'').replace(/^['"]|['"]$/g,'');
      if(!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)){append(token);continue;}
      node.style.color=color;
    }
    if(name==='size'){
      const size=Number(parsed[3]);if(!Number.isFinite(size)||size<8||size>128){append(token);continue;}
      node.style.fontSize=`${size}px`;
    }
    stack.at(-1).node.append(node);stack.push({name,node});
  }
  append(text.slice(cursor));
  if(Number.isFinite(visibleCharacters)){
    let remaining=Math.max(0,Math.floor(visibleCharacters));
    const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
    const visit=node=>{
      if(node.nodeType===3){const parts=segmenter?[...segmenter.segment(node.textContent)].map(part=>part.segment):Array.from(node.textContent);node.textContent=parts.slice(0,remaining).join('');remaining=Math.max(0,remaining-parts.length);}
      else for(const child of node.childNodes)visit(child);
    };visit(root);
  }
  container.replaceChildren(root);
}
