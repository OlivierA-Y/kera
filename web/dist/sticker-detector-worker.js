import {detectSticker} from './sticker-detector.js';
self.addEventListener('message',({data})=>{
  try{self.postMessage(detectSticker({...data,data:new Uint8ClampedArray(data.buffer)}));}
  catch{self.postMessage({boxes:null,reason:'The sticker could not be detected. Mark the four sticker patches manually.'});}
});
