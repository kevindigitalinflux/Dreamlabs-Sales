import { parseLeadPersonName } from './deepFindRules.ts';
import { isOwnerRole, isSuggestionDismissed } from './deepFindSuggestions.ts';
import { domainFromWebsite, isDirectoryDomain } from './knownPerson.ts';
import { savedDomains } from './domainChecks.ts';
import { parsePhone } from './phoneNumbers.ts';
import {recipientTier,type RecipientEvidence} from './recipientTier.ts';
import {prepareRecipientEvidence} from './recipientTierEvidence.ts';

export type Readiness = 'ready' | 'almost' | 'needs_work';
export type ReadinessMissing = 'decision_maker' | 'verified_email' | 'sendable_email' | 'company_name' | 'confirmed_website' | 'company_match';
interface ReadinessLead {
  business_name?:unknown; opted_out?:unknown;
  owner_name?: unknown; additional_owners?: unknown; email?: unknown; additional_emails?: unknown;
  website?: unknown; blocked_domains?: unknown; country?: unknown; phone?: unknown; additional_phones?: unknown;
  dismissed_suggestions?: unknown;
}
interface ReadinessContact {
  first_name?: unknown; last_name?: unknown; title?: unknown; email?: unknown;
  kind?: unknown; dismissed_at?: unknown; name_obfuscated?: unknown;
}
export interface ReadinessInput {
  lead: ReadinessLead;
  contacts: ReadinessContact[];
  domains: { domain: string; needs_check: boolean; sources: readonly string[] }[];
  /** Only addresses with a successful, valid checker verdict. Suggestions alone never qualify. */
  validEmails: string[];
  websiteSuspect: boolean;
  recipientEvidence?:Record<string,RecipientEvidence>;
}
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
/** Count only saved, live, exact-address T1/T2 recipients; informational facts do not supply evidence. */
export function sendableReadinessRecipients(input:ReadinessInput):string[] {
 const checked=new Set(input.validEmails.map(e=>e.trim().toLowerCase()));
 const addresses=[input.lead.email,...list(input.lead.additional_emails),...input.contacts.filter(c=>!c.dismissed_at).map(c=>c.email)];
 return [...new Set(addresses.map(text).map(e=>e.toLowerCase()).filter(Boolean))].filter(address=>{
  const evidence=input.recipientEvidence?.[address]??prepareRecipientEvidence(address,{checker:checked.has(address)?'valid':undefined});
  const result=recipientTier(address,{...evidence,optedOut:input.lead.opted_out===true||evidence.optedOut});
  return result.tier==='T1'||result.tier==='T2';
 });
}

/** Pure readiness assessment of saved facts using the Deep find name, site and checker rules. */
export function evaluateReadiness(input:ReadinessInput): {
  readiness: Readiness; readiness_missing: ReadinessMissing[];
} {
  const {lead,contacts,domains,websiteSuspect}=input;
  const live = contacts.filter(c => !c.dismissed_at);
  const named = (name: string) => {
    const parsed = parseLeadPersonName(name);
    return !!parsed && parsed.last.replace(/[^\p{L}]/gu, '').length >= 2
      && !isSuggestionDismissed({ name, field: 'owner_name', value: name }, lead);
  };
  const owner = [lead.owner_name, ...list(lead.additional_owners)].some(value => {
    const name = text(value);
    return named(name) && !contacts.some(c => c.dismissed_at
      && text(`${text(c.first_name)} ${text(c.last_name)}`).toLowerCase() === name.toLowerCase());
  });
  const person = owner || live.some(c => c.kind !== 'general' && c.name_obfuscated !== true
    && (isOwnerRole(c.title) || !!text(c.title)) && named(`${text(c.first_name)} ${text(c.last_name)}`));
  const email=sendableReadinessRecipients(input).length>0;
  const domain = domainFromWebsite(text(lead.website));
  const website = !!domain && !websiteSuspect && !isDirectoryDomain(domain) && !savedDomains(lead.blocked_domains).includes(domain)
    && domains.some(d => d.domain === domain && !d.needs_check
      && d.sources.some(source => ['site_confirms', 'lead_email', 'contact_email'].includes(source)));
  // Parse with the shared numbering-plan module; invalid text and historical metadata never establish a mismatch.
  const foreignPhone = lead.country === 'GB' && [lead.phone, ...list(lead.additional_phones)].some(value => {
    const parsed = parsePhone(value, 'GB');
    return !!parsed && !parsed.value.startsWith('+44');
  });
  const missing: ReadinessMissing[] = [];
  if (!person) missing.push('decision_maker');
  if (!email) missing.push('sendable_email');
  if (!text(lead.business_name)) missing.push('company_name');
  if (!website) missing.push('confirmed_website');
  if (websiteSuspect || foreignPhone) missing.push('company_match');
  return { readiness: websiteSuspect || foreignPhone ? 'needs_work' : email&&!!text(lead.business_name)?'ready':'almost', readiness_missing: missing };
}

const LABELS: Record<ReadinessMissing, string> = {
  decision_maker: 'no named decision maker', verified_email: 'no verified email',
  confirmed_website: 'no confirmed website', company_match: 'company match needs checking',
  sendable_email:'no sendable email', company_name:'no company name',
};
/** Accessible text shared by run summaries and badges; null is explicitly unchecked. */
export function readinessText(readiness: Readiness | null | undefined, missing: readonly string[] = [],supportedCount?:number): string {
  if (!readiness) return 'Not checked';
  const label = readiness === 'ready' ? 'Ready' : readiness === 'almost' ? 'Almost' : 'Needs work';
  if(readiness==='ready'&&supportedCount!==undefined)return `Ready: ${supportedCount} supported address${supportedCount===1?'':'es'}`;
  const reasons = missing.filter(key => Object.hasOwn(LABELS, key)).map(key => LABELS[key as ReadinessMissing]);
  return reasons.length ? `${label}: ${reasons.join(', ')}` : label;
}
