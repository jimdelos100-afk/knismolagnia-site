export const DEFAULT_READING_SETTINGS=Object.freeze({autoSpeed:1,masterVolume:1,dialogueOpacity:.2,textSpeed:20,bgmVolume:1,seVolume:1,voiceVolume:1,ambientVolume:1});
const bounds={autoSpeed:[.25,4],masterVolume:[0,1],dialogueOpacity:[.05,.65],textSpeed:[8,96],bgmVolume:[0,1],seVolume:[0,1],voiceVolume:[0,1],ambientVolume:[0,1]};
export function normalizeReadingSettings(input={}){
  const output={...DEFAULT_READING_SETTINGS};
  for(const [key,[min,max]] of Object.entries(bounds)){const value=input?.[key];if(typeof value==='number'&&Number.isFinite(value))output[key]=Math.max(min,Math.min(max,value));}
  return output;
}
export function readReadingSettings(storage,key='xp2-reading-settings-1'){try{storage??=globalThis.localStorage;return normalizeReadingSettings(JSON.parse(storage.getItem(key)||'null'));}catch{return {...DEFAULT_READING_SETTINGS};}}
export function saveReadingSettings(value,storage,key='xp2-reading-settings-1'){const settings=normalizeReadingSettings(value);try{storage??=globalThis.localStorage;storage.setItem(key,JSON.stringify(settings));}catch{}return settings;}
