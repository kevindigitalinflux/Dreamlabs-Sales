import {useEffect,useId,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import {visibleKeyHealth} from '../lib/keyHealthView';

/** Every mounted hook owns its channel; scoped load guards prevent old-org rows appearing after a switch. */
export function useApiKeyHealth(orgId:string|null|undefined) {
  const instance=useId();const [raw,setRaw]=useState<unknown[]>([]),[loaded,setLoaded]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null),[clock,setClock]=useState(Date.now());
  const reload=useRef<()=>Promise<void>>(async()=>{});
  useEffect(()=>{
    let active=true;setRaw([]);setLoaded(null);setError(null);
    if(!orgId){reload.current=async()=>{};return;}
    const load=async()=>{try{
      const result=await supabase.from('org_api_key_health').select('*').eq('org_id',orgId);
      if(!active)return;
      if(result.error)throw result.error;
      setRaw(Array.isArray(result.data)?result.data:[]);setClock(Date.now());setError(null);setLoaded(orgId);
    }catch{if(active){console.error('api_key_health_read_failed');setError('Could not load API key status.');setLoaded(orgId);}}};
    reload.current=load;void load();
    const filter={schema:'public',table:'org_api_key_health',filter:`org_id=eq.${orgId}`};
    const channel=supabase.channel(`api-key-health-${orgId}-${instance}`)
      .on('postgres_changes',{...filter,event:'INSERT'},()=>{void load();})
      .on('postgres_changes',{...filter,event:'UPDATE'},()=>{void load();}).subscribe();
    return ()=>{active=false;reload.current=async()=>{};void supabase.removeChannel(channel);};
  },[orgId,instance]);
  const rows=loaded===orgId&&orgId?visibleKeyHealth(raw,orgId,clock):[];
  useEffect(()=>{
    const expiries=rows.filter(row=>row.state==='rate_limited').map(row=>Date.parse(row.last_failed_at)+900_001);
    if(!expiries.length)return;
    const timer=setTimeout(()=>setClock(Date.now()),Math.max(1,Math.min(...expiries)-Date.now()));
    return ()=>clearTimeout(timer);
  },[raw,loaded,orgId,clock]);
  const hasRows=rows.length>0;
  useEffect(()=>{
    if(!orgId)return;
    let timer:ReturnType<typeof setInterval>|undefined;
    const visible=()=>document.visibilityState==='visible';
    const refreshVisible=()=>{if(visible())void reload.current();};
    const stop=()=>{if(timer!==undefined){clearInterval(timer);timer=undefined;}};
    const schedule=()=>{stop();if(hasRows&&visible())timer=setInterval(refreshVisible,60_000);};
    const visibility=()=>{schedule();refreshVisible();};
    // Filtered realtime cannot deliver deletes safely; visible polling reads through member RLS.
    schedule();window.addEventListener('focus',refreshVisible);document.addEventListener('visibilitychange',visibility);
    return ()=>{stop();window.removeEventListener('focus',refreshVisible);document.removeEventListener('visibilitychange',visibility);};
  },[orgId,hasRows]);
  return {rows,loading:!!orgId&&loaded!==orgId,error,refresh:()=>{void reload.current();}};
}
