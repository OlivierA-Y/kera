/** Cancellable five-second shutter. Uses a deadline so throttled ticks never fire early. */
export function createCaptureTimer({canCapture,onCapture,onChange=()=>{},now=()=>performance.now(),schedule=setTimeout,unschedule=clearTimeout}){
 let handle=null,deadline=null,version=0,shown=0;
 const emit=seconds=>{if(shown!==seconds){shown=seconds;onChange(seconds);}};
 function cancel(){version++;if(handle!==null)unschedule(handle);handle=null;deadline=null;emit(0);}
 function tick(generation){
  if(generation!==version||deadline===null)return;
  if(!canCapture()){cancel();return;}
  const remaining=Math.max(0,Math.ceil((deadline-now())/1000));
  if(!remaining){cancel();if(canCapture())onCapture();return;}
  emit(remaining);
  if(generation===version&&deadline!==null)handle=schedule(()=>tick(generation),Math.min(1000,Math.max(1,deadline-now())));
 }
 return{get active(){return deadline!==null;},cancel,start(){
  if(deadline!==null||!canCapture())return false;
  deadline=now()+5000;const generation=++version;tick(generation);return true;
 }};
}
