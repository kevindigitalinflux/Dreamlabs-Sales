import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';
import {useOrg} from './useOrg';
import {emailEvidenceView} from '../lib/emailVerification';

interface Row {org_id:string;address:string;outcome:string;seen_at:string}
/** Cache display only: the server rechecks outcome safety immediately before every send. */
export function useEmailVerification(addresses:string[]) {
  const {currentOrg}=useOrg();const orgId=currentOrg?.id??'';
  const key=`${orgId}:${[...new Set(addresses.map(a=>a.trim().toLowerCase()))].sort().join(',')}`;
  const [state,setState]=useState({key:'',rows:[] as Row[],error:false});
  useEffect(()=>{
    let cancelled=false;setState({key,rows:[],error:false});
    void (async()=>{
      try {
        if(!orgId)return;
        const emails=[...new Set(addresses.map(a=>a.trim().toLowerCase()).filter(Boolean))];
        const rows:Row[]=[];
        for(let i=0;i<emails.length;i+=20) {
          const {data,error,count}=await supabase.from('email_outcomes').select('org_id,address,outcome,seen_at',{count:'exact'})
            .eq('org_id',orgId).in('address',emails.slice(i,i+20));
          if(error||typeof count!=='number'||count!==data?.length)throw new Error('Outcome history unavailable');
          rows.push(...data);
        }
        if(!cancelled)setState({key,rows,error:false});
      }catch{console.error('email review: outcome history unavailable');if(!cancelled)setState({key,rows:[],error:true});}
    })();
    return()=>{cancelled=true;};
  },[orgId,key,addresses]);
  return {get:(address:string)=>emailEvidenceView(orgId,address,state.key===key?state.rows:[]),error:state.key===key&&state.error};
}
