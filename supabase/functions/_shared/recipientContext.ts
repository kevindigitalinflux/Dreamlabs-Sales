import type {SupabaseClient} from 'npm:@supabase/supabase-js@2';
import {recipientTier,type RecipientEvidence} from './recipientTier.ts';
import {prepareRecipientEvidence,supportedTierPattern,outcomeTierEvidence} from './recipientTierEvidence.ts';
import {lookupMx,cachedMailProvider} from './dnsLookup.ts';
import {parseLeadPersonName} from './deepFindRules.ts';
import {savedDomains} from './domainChecks.ts';
import {sentOkAddresses} from './sentRecipientEvidence.ts';
import {readComplete} from './readComplete.ts';
import {tierMetrics,type TierSend} from './tierMetrics.ts';
import {isRecipientBlocked} from './selectedLeadPipelineRules.ts';
/** Current, bounded, org-scoped facts. This service reader never accepts tier evidence from the browser. */
export async function loadRecipientContext(service:SupabaseClient,orgId:string,leadId:string) {
 const [l,c,o,h,s,b]=await Promise.all([
  service.from('leads').select('*').eq('id',leadId).eq('org_id',orgId).maybeSingle(),
  service.from('decision_maker_candidates').select('*').eq('lead_id',leadId),
  readComplete(()=>service.from('email_outcomes').select('*',{count:'exact'}).eq('org_id',orgId)),
  service.from('deep_find_leads').select('domains',{count:'exact'}).eq('lead_id',leadId).eq('org_id',orgId).order('updated_at',{ascending:false}).limit(1000),
  readComplete(()=>service.from('email_logs').select('id,org_id,to_email,status,sent_at,hard_bounced_at,recipient_tier_at_send,recipient_tier_version,recipient_was_sent_ok',{count:'exact'}).eq('org_id',orgId).eq('status','sent')),
  readComplete(()=>service.from('outreach_blocklist').select('id,value',{count:'exact'}).eq('org_id',orgId)),
 ]);
 if(l.error||c.error||o.error||h.error||s.error||!l.data||o.count!==o.data?.length||h.count!==h.data?.length||s.count!==s.data?.length)throw Error('Recipient evidence could not be read completely.');
 const sentOk=new Set(sentOkAddresses(orgId,s.data as Parameters<typeof sentOkAddresses>[1],o.data as Parameters<typeof sentOkAddresses>[2]));
 const confidence=tierMetrics(orgId,s.data as TierSend[]);
 const blocked=new Set(b.data.map(row=>String(row.value)));
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
  const history=outcomeTierEvidence(orgId,email,o.data.map(row=>({org_id:String(row.org_id),address:String(row.address),outcome:String(row.outcome)})));
  const checks=(o.data??[]).filter(row=>row.address===email&&/^checked_/.test(row.outcome)&&Date.parse(row.seen_at)>=Date.now()-14*86400000&&Date.parse(row.seen_at)<=Date.now()).sort((a,b)=>Date.parse(b.seen_at)-Date.parse(a.seen_at));
  const checker=checks[0]?.outcome==='checked_valid'?'valid':checks[0]?.outcome==='checked_invalid'?'invalid':undefined;
  const old=proofs[email];const generated=old?.generated===true||guesses.has(email);
  const saved=lead.email?.trim().toLowerCase()===email||contacts.some(row=>row.source==='manual'&&row.email?.trim().toLowerCase()===email);
  return prepareRecipientEvidence(email,{...old,...history,sentOk:sentOk.has(email),checker,generated,catchAll:old?.roleNeedsReview===true,provider:cachedMailProvider(domain)??'unknown',
   hasMailServer:mail==='none'?false:mail==='mx'?true:null,optedOut:lead.opted_out===true,blocklisted:isRecipientBlocked(email,blocked)||savedDomains(lead.blocked_domains).includes(domain),
   savedNonGuessed:old?.savedNonGuessed===true||(saved&&!generated&&!old),supportedGuessAllowed:confidence.t2Allowed,
  });
 }
 async function assess(address:string) {
  const email=address.trim().toLowerCase();const raw=await evidence(email);
  const samples=await Promise.all(known.filter(row=>!!row.email).slice(0,40).map(async row=>({email:String(row.email),first:row.first??null,last:row.last??null,evidence:await evidence(String(row.email))})));
  const person=known.find(row=>row.email?.trim().toLowerCase()===email);
  const name=person?.first&&person?.last?{first:person.first,last:person.last}:null;
  let pattern=raw.pattern??(name?supportedTierPattern(email,name,samples,[]):null);
  if(pattern){const support=await Promise.all(pattern.t1Support.map(async sample=>recipientTier(sample.address,await evidence(sample.address)).tier==='T1'?sample:null));pattern={...pattern,t1Support:support.filter((sample):sample is NonNullable<typeof sample>=>sample!==null)};}
  const full={...raw,pattern};
  return {evidence:full,result:recipientTier(email,full)};
 }
 return {lead,contacts,assess};
}
