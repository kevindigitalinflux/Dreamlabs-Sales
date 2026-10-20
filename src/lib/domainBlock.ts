import { domainFromWebsite } from '../../supabase/functions/_shared/knownPerson';

/** Which of a lead's blocked domains are the lead's OWN website or saved email domain (what Deep find would otherwise use). */
export function ownBlockedDomains(lead: { website?: string | null; email?: string | null; blocked_domains?: string[] | null }): { domain: string; kind: 'website' | 'email' }[] {
  const blocked = (lead.blocked_domains ?? []).map((d) => d.toLowerCase());
  const out: { domain: string; kind: 'website' | 'email' }[] = [];
  const site = domainFromWebsite(lead.website);
  if (site && blocked.includes(site)) out.push({ domain: site, kind: 'website' });
  const at = (lead.email ?? '').trim().toLowerCase().split('@');
  const mail = at.length === 2 ? domainFromWebsite(at[1]) : null;
  if (mail && blocked.includes(mail) && !out.some((o) => o.domain === mail)) out.push({ domain: mail, kind: 'email' });
  return out;
}

/** The arrays after undoing a block: out of blocked_domains, and back into email_domains only if the block removed it from there. */
export function planUnblock(current: { blocked: string[]; email: string[] }, domain: string, restoreToEmail: boolean): { blocked: string[]; email: string[] } {
  const blocked = current.blocked.filter((d) => d !== domain);
  const email = restoreToEmail && !current.email.includes(domain) && current.email.length < 8 ? [...current.email, domain] : current.email;
  return { blocked, email };
}
