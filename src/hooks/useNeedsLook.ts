import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';
import {needsLook} from '../lib/needsLook';
import {recipientTier,type RecipientEvidence} from '../../supabase/functions/_shared/recipientTier';
import type {Lead} from '../types';
/** Review hints only; bulk generation and sending independently recheck current server evidence. */
export function useNeedsLook(leads:Lead[],orgId:string|null|undefined) {
 const [ids,setIds]=useState<string[]>([]),[error,setError]=useState<string|null>(null);
 useEffect(()=>{
  let cancelled=false;setIds([]);setError(null);if(!orgId)return;
  void (async()=>{
   try{
    const [runs,outcomes]=await Promise.all([
     supabase.from('deep_find_leads').select('lead_id,domains',{count:'exact'}).eq('org_id',orgId).order('updated_at',{ascending:false}).limit(1000),
     supabase.from('email_outcomes').select('address',{count:'exact'}).eq('org_id',orgId).eq('outcome','bounced_hard').limit(1000),
    ]);
    if(runs.error||outcomes.error||runs.count!==runs.data?.length||outcomes.count!==outcomes.data?.length)throw Error('Incomplete review hints');
    const latest=new Map<string,Record<string,unknown>>();for(const row of runs.data??[])if(!latest.has(row.lead_id))latest.set(row.lead_id,row.domains??{});
    const bounced=(outcomes.data??[]).map(row=>row.address);
    const found=leads.filter(lead=>{
     const data=latest.get(lead.id)??{};const evidence=Object.entries((data.recipient_evidence??{}) as Record<string,RecipientEvidence>);
     const tiers=evidence.map(([address,proof])=>recipientTier(address,proof).tier);
     return needsLook(lead,{bounced,weakOnly:tiers.includes('T3')&&!tiers.some(tier=>tier==='T1'||tier==='T2'),websiteSuspect:data.website_suspect===true,
      companyConflict:!lead.company_number&&Array.isArray(data.company_candidates)&&data.company_candidates.length>0});
    }).map(lead=>lead.id);
    if(!cancelled)setIds(found);
   }catch(error){console.error('Review hints unavailable',error instanceof Error?error.name:'Error');if(!cancelled){setIds(leads.filter(lead=>needsLook(lead,{})).map(lead=>lead.id));setError('Some review hints could not be loaded. Refresh before relying on this filter.');}}
  })();return()=>{cancelled=true;};
 },[leads,orgId]);
 return {ids,error};
}
