import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabase';
import {DOMAIN_BOUNCE_WARNING,loadDomainBounceWarnings} from '../../../supabase/functions/_shared/emailOutcomeSignals';

/** Org-scoped aggregate warnings for the domains displayed in this lead's Contacts card. */
export function DomainBounceWarnings({orgId,addresses,website}:{orgId:string;addresses:(string|null)[];website:string|null}) {
  let site='';try{site=website?new URL(website.includes('://')?website:`https://${website}`).hostname.replace(/^www\./,''):'';}catch{/* A malformed saved website adds no domain. */}
  const domains=[...new Set([...addresses.map(a=>a?.trim().toLowerCase().split('@')[1]??''),site].filter(Boolean))].sort();
  const domainKey=domains.join(',');const key=`${orgId}:${domainKey}`;
  const [state,setState]=useState({key:'',warnings:[] as string[],error:false,loading:true});
  useEffect(()=>{
    let cancelled=false;
    setState({key,warnings:[],error:false,loading:true});
    void (async()=>{
      try {
        const warnings=await loadDomainBounceWarnings(supabase,orgId,domainKey.split(',').filter(Boolean));
        if(!cancelled)setState({key,warnings,error:false,loading:false});
      }catch{console.error('bounce history: could not load domain counts');if(!cancelled)setState({key,warnings:[],error:true,loading:false});}
    })();
    return()=>{cancelled=true;};
  },[orgId,domainKey,key]);
  if(!domainKey)return null;
  if(state.key!==key||state.loading)return <p className="mt-2 text-xs text-muted" role="status">Checking recent bounce history…</p>;
  if(state.error)return <p className="mt-2 text-xs text-warning" role="alert">Could not check recent bounce history. Refresh to try again.</p>;
  return <>{state.warnings.map(domain=><p key={domain} className="mt-2 break-words text-xs text-warning" role="status">{domain}: {DOMAIN_BOUNCE_WARNING}</p>)}</>;
}
