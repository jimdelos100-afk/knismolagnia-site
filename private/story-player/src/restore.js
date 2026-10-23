import {parseProgress} from './progress.js';
import {mergeTranslationDocument} from './translations.js';
/** Recover independent parts without modifying or discarding a saved envelope. */
export function restoreProject(story,translations,saved,{useSavedTranslations=true}={}){
  const result={progress:null,translations,language:'translation',errors:[],preserved:null};
  if(saved===undefined||saved===null)return result;
  if(typeof saved!=='object'||Array.isArray(saved)){result.errors.push('本机记录格式不匹配');result.preserved=structuredClone(saved);return result;}
  try{result.progress=parseProgress(story,saved.progress);}catch{result.errors.push('浏览位置与当前演出包不匹配');}
  if(useSavedTranslations&&saved.translations!==undefined)try{result.translations=mergeTranslationDocument(story,translations,saved.translations).document;}catch{result.errors.push('部分本机译文与当前演出包不匹配');}
  if(['original','translation'].includes(saved.language))result.language=saved.language;
  if(result.errors.length)result.preserved=structuredClone(saved);
  return result;
}
