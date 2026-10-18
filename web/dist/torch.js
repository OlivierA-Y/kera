/** Camera torch control; never claims a state the track does not report. */
export function createTorchController({onChange=()=>{}}={}){
 let track=null,version=0,preferred=true,state={supported:false,busy:false,on:null,requested:false,message:''};
 function update(value){state={...state,...value};onChange(state);}
 function reset(){version++;track=null;update({supported:false,busy:false,on:null,requested:false,message:''});}
 function reportedState(current){try{const value=current.getSettings?.().torch;return typeof value==='boolean'?value:null;}catch{return null;}}
 async function apply(desired){
  if(!track||!state.supported||state.busy)return;
  const current=track,generation=version;
  update({busy:true,requested:desired,message:''});
  try{
   const previous=current.getConstraints?.()||{};
   const advanced=(previous.advanced||[]).map(entry=>{const {torch,...rest}=entry;return rest;}).filter(entry=>Object.keys(entry).length);
   await current.applyConstraints({...previous,torch:desired,advanced:[...advanced,{torch:desired}]});
   if(generation!==version||current!==track)return;
   const on=reportedState(current);
   update({busy:false,on,message:on===null?'Flashlight requested; this browser does not report its state.':on!==desired?'The camera did not change the flashlight. You can try again.':''});
  }catch{
   if(generation!==version||current!==track)return;
   update({busy:false,on:reportedState(current),message:'The flashlight could not be changed. The camera is still available.'});
  }
 }
 async function attach(next){
  reset();track=next;
  let capabilities;try{capabilities=track?.getCapabilities?.();}catch{}
  const supported=Boolean(track?.applyConstraints)&&(capabilities?.torch===true||(Array.isArray(capabilities?.torch)&&capabilities.torch.includes(true)));
  update({supported,message:supported?'':'Flashlight is unavailable for this camera or browser.'});
  if(supported)await apply(preferred);
 }
 async function toggle(){if(state.busy||!state.supported)return;preferred=!(state.on??state.requested);await apply(preferred);}
 return{attach,toggle,reset,get state(){return state;}};
}
