import { parseLeadPersonName } from './deepFindRules.ts';
import { isOwnerRole, isSuggestionDismissed } from './deepFindSuggestions.ts';
import { domainFromWebsite, isDirectoryDomain } from './knownPerson.ts';
import { savedDomains } from './domainChecks.ts';
import { parsePhone } from './phoneNumbers.ts';

export type Readiness = 'ready' | 'almost' | 'needs_work';
export type ReadinessMissing = 'decision_maker' | 'verified_email' | 'confirmed_website' | 'company_match';
interface ReadinessLead {
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
}
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** Pure readiness assessment of saved facts using the Deep find name, site and checker rules. */
export function evaluateReadiness({ lead, contacts, domains, validEmails, websiteSuspect }: ReadinessInput): {
  readiness: Readiness; readiness_missing: ReadinessMissing[];
} {
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
  const checked = new Set(validEmails.map(email => email.trim().toLowerCase()));
  const email = [lead.email, ...list(lead.additional_emails), ...live.map(c => c.email)]
    .some(value => !!text(value) && checked.has(text(value).toLowerCase()));
  const domain = domainFromWebsite(text(lead.website));
  const website = !!domain && !isDirectoryDomain(domain) && !savedDomains(lead.blocked_domains).includes(domain)
    && domains.some(d => d.domain === domain && !d.needs_check && d.sources.includes('site_confirms'));
  // Parse with the shared numbering-plan module; invalid text and historical metadata never establish a mismatch.
  const foreignPhone = lead.country === 'GB' && [lead.phone, ...list(lead.additional_phones)].some(value => {
    const parsed = parsePhone(value, 'GB');
    return !!parsed && !parsed.value.startsWith('+44');
  });
  const missing: ReadinessMissing[] = [];
  if (!person) missing.push('decision_maker');
  if (!email) missing.push('verified_email');
  if (!website) missing.push('confirmed_website');
  if (websiteSuspect || foreignPhone) missing.push('company_match');
  return { readiness: websiteSuspect || foreignPhone || missing.length >= 2 ? 'needs_work' : missing.length ? 'almost' : 'ready', readiness_missing: missing };
}

const LABELS: Record<ReadinessMissing, string> = {
  decision_maker: 'no named decision maker', verified_email: 'no verified email',
  confirmed_website: 'no confirmed website', company_match: 'company match needs checking',
};
/** Accessible text shared by run summaries and badges; null is explicitly unchecked. */
export function readinessText(readiness: Readiness | null | undefined, missing: readonly string[] = []): string {
  if (!readiness) return 'Not checked';
  const label = readiness === 'ready' ? 'Ready' : readiness === 'almost' ? 'Almost' : 'Needs work';
  const reasons = missing.filter(key => Object.hasOwn(LABELS, key)).map(key => LABELS[key as ReadinessMissing]);
  return reasons.length ? `${label}: ${reasons.join(', ')}` : label;
}
