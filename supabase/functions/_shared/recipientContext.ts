import type {SupabaseClient} from 'npm:@supabase/supabase-js@2';
import {recipientTier,type RecipientEvidence} from './recipientTier.ts';
import {prepareRecipientEvidence,supportedTierPattern,outcomeTierEvidence} from './recipientTierEvidence.ts';
import {lookupMx,cachedMailProvider} from './dnsLookup.ts';
import {parseLeadPersonName} from './deepFindRules.ts';
import {savedDomains} from './domainChecks.ts';
/** Current, bounded, org-scoped facts. This service reader never accepts tier evidence from the browser. */
export async function loadRecipientContext(service:SupabaseClient,orgId:string,leadId:string) {
 const [l,c,o,h]=await Promise.all([
  service.from('leads').select('*').eq('id',leadId).eq('org_id',orgId).maybeSingle(),
  service.from('decision_maker_candidates').select('*').eq('lead_id',leadId),
  service.from('email_outcomes').select('*',{count:'exact'}).eq('org_id',orgId).limit(1000),
  service.from('deep_find_leads').select('domains',{count:'exact'}).eq('lead_id',leadId).eq('org_id',orgId).order('updated_at',{ascending:false}).limit(1000),
 ]);
 if(l.error||c.error||o.error||h.error||!l.data||o.count!==o.data?.length||h.count!==h.data?.length)throw Error('Recipient evidence could not be read completely.');
 const lead=l.data;const contacts=(c.data??[]).filter(row=>!row.dismissed_at);
 const proofs:Record<string,RecipientEvidence>={};const guesses=new Set<string>();
 for(const row of h.data??[]) {
  for(const [address,proof] of Object.entries(row.domains?.recipient_evidence??{}))if(!proofs[address])proofs[address]=proof as RecipientEvidence;
  for(const s of row.domains?.suggestions??[])if(typeof s.value==='string'&&(s.guess_rank||/guess|pattern-supported/i.test(s.label??'')))guesses.add(s.value.toLowerCase());
 }
 const known=[{email:lead.email,...parseLeadPersonName(lead.owner_name)},...contacts.map(row=>({email:row.email,first:row.first_name,last:row.last_name}))];
 const mx=new Map<string,Promise<Awaited<ReturnType<typeof lookupMx>>>>();
 async function evidence(address:string):Promise<RecipientEvidence> {
  const email=address.trim().toLowerCase();const domain=email.split('@')[1]??'';
  if(!mx.has(domain))mx.set(domain,lookupMx(domain,3000,true));const mail=await mx.get(domain);
  const history=outcomeTierEvidence(orgId,email,o.data??[]);
  const checks=(o.data??[]).filter(row=>row.address===email&&/^checked_/.test(row.outcome)&&Date.parse(row.seen_at)>=Date.now()-14*86400000&&Date.parse(row.seen_at)<=Date.now()).sort((a,b)=>Date.parse(b.seen_at)-Date.parse(a.seen_at));
  const checker=checks[0]?.outcome==='checked_valid'?'valid':checks[0]?.outcome==='checked_invalid'?'invalid':undefined;
  const old=proofs[email];const generated=old?.generated===true||guesses.has(email);
  const saved=lead.email?.trim().toLowerCase()===email||contacts.some(row=>row.source==='manual'&&row.email?.trim().toLowerCase()===email);
  return prepareRecipientEvidence(email,{...old,...history,checker,generated,provider:cachedMailProvider(domain)??'unknown',
   hasMailServer:mail==='none'?false:mail==='mx'?true:null,optedOut:lead.opted_out===true,blocklisted:savedDomains(lead.blocked_domains).includes(domain),
   savedNonGuessed:old?.savedNonGuessed===true||(saved&&!generated&&!old),
  });
 }
 async function assess(address:string) {
  const email=address.trim().toLowerCase();const raw=await evidence(email);
  const samples=await Promise.all(known.filter(row=>!!row.email).slice(0,40).map(async row=>({email:String(row.email),first:row.first??null,last:row.last??null,evidence:await evidence(String(row.email))})));
  const person=known.find(row=>row.email?.trim().toLowerCase()===email);
  const name=person?.first&&person?.last?{first:person.first,last:person.last}:null;
  const full={...raw,pattern:raw.pattern??(name?supportedTierPattern(email,name,samples,[]):null)};
  return {evidence:full,result:recipientTier(email,full)};
 }
 return {lead,contacts,assess};
}
