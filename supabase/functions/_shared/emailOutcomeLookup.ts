import type {SupabaseClient} from 'npm:@supabase/supabase-js@2';
import {validEmail} from './contacts.ts';
export interface KnownEmailOutcome {status:'valid'|'invalid';reason:'previously_replied'|'bounced_hard'}
/** Exact evidence is org-scoped and memoised for one operation only; missing storage is never a clean bill of health. */
export function makeEmailOutcomeLookup(service:SupabaseClient,orgId:string) {
  const values=new Map<string,KnownEmailOutcome|null>();
  const pending=new Map<string,Promise<KnownEmailOutcome|null>>();
  const status=(address:string):Promise<KnownEmailOutcome|null>=>{
    const email=validEmail(address);if(!email)return Promise.resolve(null);
    if(!pending.has(email))pending.set(email,(async()=>{
      const {data,error}=await service.from('email_outcomes').select('outcome').eq('org_id',orgId).eq('address',email);
      if(error)throw new Error('Email outcome history is unavailable');
      const result:KnownEmailOutcome|null=data?.some(r=>r.outcome==='bounced_hard')?{status:'invalid',reason:'bounced_hard'}
        :data?.some(r=>r.outcome==='replied')?{status:'valid',reason:'previously_replied'}:null;
      values.set(email,result);return result;
    })());
    return pending.get(email)!;
  };
  return {status,peek:(address:string)=>values.get(address.trim().toLowerCase())??null,
    async replySamples(domain:string):Promise<{email:string;first:null;last:null;published:true}[]> {
      const {data,error,count}=await service.from('email_outcomes').select('address',{count:'exact'}).eq('org_id',orgId).eq('domain',domain).eq('outcome','replied');
      // Decline a partial or large confidence sample instead of silently ignoring conflicting formats.
      if(error||typeof count!=='number'||count!==data?.length||count>50){if(error)console.error('email outcomes: reply format history unavailable');return [];}
      const checked=await Promise.all((data??[]).map(async row=>(await status(row.address))?.status==='valid'?row.address:null));
      return checked.filter((email):email is string=>!!email).map(email=>({email,first:null,last:null,published:true}));
    },
  };
}
