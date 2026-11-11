import type {SupabaseClient} from 'npm:@supabase/supabase-js@2';
/** Separate from drafting and exploratory AI. One durable reservation per lead, at most 50 per run. */
export async function reserveRunRegistryProof(service:SupabaseClient,orgId:string,runId:string,leadId:string):Promise<boolean> {
 for(let attempt=0;attempt<20;attempt++){
  const read=await service.from('deep_find_leads').select('id,domains').eq('org_id',orgId).eq('run_id',runId).order('id').limit(1).maybeSingle();
  if(read.error||!read.data)return false;
  const domains=read.data.domains??{};const used=domains._registry_proof;
  if(used!==undefined&&(!Array.isArray(used)||used.some(value=>typeof value!=='string')))return false;
  const ids:string[]=used??[];if(ids.includes(leadId)||ids.length>=50)return false;
  const write=await service.from('deep_find_leads').update({domains:{...domains,_registry_proof:[...ids,leadId]}})
   .eq('id',read.data.id).eq('org_id',orgId).eq('run_id',runId).eq('domains',JSON.stringify(domains)).select('id');
  if(write.error)return false;if(write.data?.length)return true;
 }
 return false;
}
