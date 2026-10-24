import {decodeTextureRGBA} from './unity-local.js';

self.onmessage=async event=>{
  const {id,bytes,asset}=event.data;
  try{
    const pixels=decodeTextureRGBA(new Uint8Array(bytes),asset);
    const canvas=new OffscreenCanvas(asset.width,asset.height),context=canvas.getContext('2d');
    if(!context)throw new Error('无法创建图片画布');
    context.putImageData(new ImageData(pixels,asset.width,asset.height),0,0);
    self.postMessage({id,blob:await canvas.convertToBlob({type:'image/png'})});
  }catch(error){self.postMessage({id,error:error?.message||String(error)});}
};
