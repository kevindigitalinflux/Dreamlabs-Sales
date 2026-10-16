// Import-free review and country rules shared by Deep find and its session UI.
export interface ReviewSuggestion { name: string; value?: string; role?: string | null; label?: string; field?: string }
export interface ReviewLead {
  email?: unknown; additional_emails?: unknown; dismissed_suggestions?: unknown;
  country?: unknown; registry_candidates_rejected?: unknown;
}
export interface ReviewContact {
  id: string; first_name?: string | null; last_name?: string | null; email?: string | null; dismissed_at?: string | null;
}
const norm = (v: unknown): string => typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '';
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const nameOf = (c: ReviewContact) => norm(`${c.first_name ?? ''} ${c.last_name ?? ''}`);
const ROLE_MAILBOXES = new Set(['privacy','gdpr','dpo','legal','compliance','careers','jobs','recruitment','press','media','abuse','postmaster','webmaster','noreply','no-reply','donotreply','unsubscribe']);

export function suggestionKey(s: ReviewSuggestion): string {
  return s.value ? `email:${norm(s.value)}` : `person:${norm(s.name)}`;
}
export function isRoleMailbox(email: string | undefined): boolean {
  return ROLE_MAILBOXES.has(norm(email).split('@')[0]!);
}

/** Existing and dismissed contacts also suppress suggestions: a rerun must not restore removed people. */
export function visibleSuggestions<T extends ReviewSuggestion>(suggestions: T[], lead: ReviewLead, contacts: ReviewContact[]): T[] {
  const seen = new Set(strings(lead.dismissed_suggestions).map(norm));
  const emails = new Set([norm(lead.email), ...strings(lead.additional_emails).map(norm), ...contacts.map((c) => norm(c.email))].filter(Boolean));
  return suggestions.filter((s) => {
    if (!norm(s.name) || (s.field && s.field !== 'email') || (s.value !== undefined && !validEmail(norm(s.value)))) return false;
    const key = suggestionKey(s);
    if (seen.has(key)) return false;
    seen.add(key);
    const same = contacts.find((c) => nameOf(c) === norm(s.name));
    return s.value ? !emails.has(norm(s.value)) && !(same && (same.dismissed_at || norm(same.email))) : !same;
  }).sort((a, b) => Number(isRoleMailbox(a.value)) - Number(isRoleMailbox(b.value)));
}

export type SuggestionAddPlan =
  | { kind: 'none' }
  | { kind: 'lead_update'; patch: { email: string } | { additional_emails: string[] } }
  | { kind: 'contact_update'; id: string; patch: { email: string; include_in_sequences: false } }
  | { kind: 'contact_insert'; patch: { source: 'manual'; kind: 'person'; first_name: string; last_name: string | null; title: string | null; email: string | null; include_in_sequences: false; is_primary: false } };

/** Plans only blank fills or new rows. The caller supplies lead_id/created_by from the signed-in session. */
export function planSuggestionAdd(s: ReviewSuggestion, lead: ReviewLead, contacts: ReviewContact[]): SuggestionAddPlan {
  if (!visibleSuggestions([s], lead, contacts).length) return { kind: 'none' };
  const email = norm(s.value);
  if (s.name.trim() === 'Company contact' && email) {
    return !norm(lead.email) ? { kind: 'lead_update', patch: { email } }
      : { kind: 'lead_update', patch: { additional_emails: [...new Set([...strings(lead.additional_emails).map(norm).filter(Boolean), email])] } };
  }
  const same = contacts.find((c) => nameOf(c) === norm(s.name));
  if (same) return email && !norm(same.email) && !same.dismissed_at
    ? { kind: 'contact_update', id: same.id, patch: { email, include_in_sequences: false } } : { kind: 'none' };
  const [first, ...rest] = s.name.trim().split(/\s+/);
  return { kind: 'contact_insert', patch: { source: 'manual', kind: 'person', first_name: first!, last_name: rest.join(' ') || null,
    title: s.role?.trim() || null, email: email || null, include_in_sequences: false, is_primary: false } };
}

export function registrySkipReason(lead: ReviewLead): 'not_uk' | 'rejected' | null {
  if (['IE', 'US', 'OTHER'].includes(String(lead.country))) return 'not_uk';
  return lead.registry_candidates_rejected === true ? 'rejected' : null;
}

/** Used only for explicitly selected countries; null/GB retain the historical website rule. */
export function countryPhoneMismatch(text: string, country: unknown): boolean {
  if (country !== 'IE' && country !== 'US') return false;
  const phones = [...text.matchAll(/(?:\+|\b00)\s*(\d[\d\s().-]{6,}\d)/g)].map((m) => m[1]!.replace(/\D/g, ''));
  const localIrish = country === 'IE' && /\b08\d[\s-]?\d{3}[\s-]?\d{4}\b/.test(text);
  return phones.length > 0 && !localIrish && !phones.some((p) => country === 'IE' ? p.startsWith('353') : p.startsWith('1'));
}
