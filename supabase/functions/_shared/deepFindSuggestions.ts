import { displayPersonKey, fullestPeople } from './personIdentity.ts';
// Import-free review and country rules shared by Deep find and its session UI.
export interface ReviewSuggestion { guess_rank?: 'most_likely' | 'other'; name: string; value?: string; role?: string | null; label?: string; field?: string }
export interface ReviewLead {
  email?: unknown; additional_emails?: unknown; dismissed_suggestions?: unknown;
  country?: unknown; registry_candidates_rejected?: unknown; owner_name?: unknown;
  phone?: unknown; website?: unknown;
}
export interface ReviewContact {
  id: string; first_name?: unknown; last_name?: unknown; email?: unknown; dismissed_at?: unknown; title?: unknown; linkedin_url?: unknown;
}
const norm = (v: unknown): string => typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '';
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
/** Accept phone shapes only, never arbitrary numbers extracted from page text. */
export function isReviewPhone(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const raw = value.trim();
  if (/^\s*\d{1,2}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{2,4}\s*$/.test(raw)) return false;
  if (!/^\+?[\d\s().-]+$/.test(raw) || /\d{4}-\d{2}-\d{2}|^\d{4}-\d{4}$/.test(raw)) return false;
  let digits = raw.replace(/\D/g, '');
  if (/^(\d)\1+$/.test(digits) || /(\d)\1{6}/.test(digits)) return false;
  if (raw.startsWith('+44')) {
    digits = digits.slice(2).replace(/^0/, '');
    return /^[12378]\d{9}$/.test(digits);
  }
  if (raw.startsWith('+353')) return /^[1-9]\d{7,9}$/.test(digits.slice(3).replace(/^0/, ''));
  if (raw.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits);
  return /^0[12378]\d{8,9}$/.test(digits) || /^0[1-9]\d{6,8}$/.test(digits);
}
const nameOf = (c: ReviewContact) => norm(`${norm(c.first_name)} ${norm(c.last_name)}`);
const ROLE_MAILBOXES = new Set(['privacy','gdpr','dpo','legal','compliance','careers','jobs','recruitment','press','media','abuse','postmaster','webmaster','noreply','no-reply','donotreply','unsubscribe']);

/** Canonical keys shared by review, automatic fills and Undo. */
export function suggestionKey(s: ReviewSuggestion): string {
  const value = norm(s.value);
  if (s.field === 'company_number') return 'company_number:' + value;
  if (s.field === 'title') return 'title:' + norm(s.name);
  if (s.field === 'owner_name') return 'owner:' + value;
  if (s.field === 'phone') return 'phone:' + value.replace(/\D/g, '');
  if (s.field === 'website' || s.field === 'additional_websites') {
    try { return 'website:' + new URL(/^https?:\/\//.test(value) ? value : 'https://' + value).hostname.replace(/^www\./, ''); }
    catch { return 'website:' + value; }
  }
  if (s.field === 'linkedin_url') return 'linkedin:' + value.replace(/\/$/, '');
  return s.value ? 'email:' + value : 'person:' + norm(s.name);
}

/** Older saved keys retain their dismissal meaning after canonicalisation. */
export function isSuggestionDismissed(s: ReviewSuggestion, lead: ReviewLead): boolean {
  const keys = strings(lead.dismissed_suggestions).map(key => {
    const raw = norm(key);
    if (raw.startsWith('website:')) return suggestionKey({ name: '', field: 'website', value: raw.slice(8) });
    if (raw.startsWith('phone:')) return suggestionKey({ name: '', field: 'phone', value: raw.slice(6) });
    if (raw.startsWith('owner_name:')) return 'owner:' + raw.slice(11);
    if (raw.startsWith('title:')) return raw.split(':').slice(0, 2).join(':');
    if (raw.startsWith('linkedin_url:')) return 'linkedin:' + raw.slice(raw.indexOf('https://')).replace(/\/$/, '');
    return raw;
  });
  const legacy = s.field === 'owner_name' ? 'owner_name:' + norm(s.value)
    : s.field === 'title' ? 'title:' + norm(s.name) + ':' + norm(s.value)
    : s.field === 'linkedin_url' ? 'linkedin_url:' + norm(s.name) + ':' + norm(s.value)
    : (s.field ?? 'email') + ':' + norm(s.value);
  const displayKey = displayPersonKey(s.field === 'owner_name' ? s.value : s.name);
  const personDismissed = !!displayKey && keys.some(key => key.startsWith('person:') && displayPersonKey(key.slice(7)) === displayKey);
  return personDismissed || keys.includes(suggestionKey(s)) || keys.includes(legacy)
    || ((s.field === 'owner_name' || s.field === 'title') && keys.includes('person:' + norm(s.field === 'owner_name' ? s.value : s.name)));
}
export function isRoleMailbox(email: string | undefined): boolean {
  return ROLE_MAILBOXES.has(norm(email).split('@')[0]!);
}

/** Existing and dismissed contacts also suppress suggestions: a rerun must not restore removed people. */
export function visibleSuggestions<T extends ReviewSuggestion>(suggestions: T[], lead: ReviewLead, contacts: ReviewContact[]): T[] {
  const seen = new Set(strings(lead.dismissed_suggestions).map(norm));
  const emails = new Set([norm(lead.email), ...strings(lead.additional_emails).map(norm), ...contacts.map((c) => norm(c.email))].filter(Boolean));
  const priority = (s: ReviewSuggestion) => s.field === 'owner_name' || ((!s.field || s.field === 'email') && !!s.value && s.name !== 'Company contact') ? 0 : 1;
  const owners = new Set(fullestPeople(suggestions.filter(s => s.field === 'owner_name'), s => s.value ?? s.name));
  return fullestPeople(suggestions.filter(s => s.field !== 'owner_name' || owners.has(s)), s => !s.value && !s.field ? s.name : '').sort((a, b) => Number(a.guess_rank === 'other') - Number(b.guess_rank === 'other') || priority(a) - priority(b) || Number(isRoleMailbox(a.value)) - Number(isRoleMailbox(b.value))).filter((s) => {
    if (isSuggestionDismissed(s, lead)) return false;
    if (s.field === 'title') {
      const same = contacts.find((c) => nameOf(c) === norm(s.name));
      const key = suggestionKey(s);
      if (!same || same.dismissed_at || norm(same.title) || !norm(s.value) || seen.has(key)) return false;
      seen.add(key); return true;
    }
    if (s.field === 'phone' || s.field === 'owner_name' || s.field === 'website') {
      const key = suggestionKey(s);
      if (!norm(s.value) || norm(lead[s.field]) || seen.has(key)) return false;
      if (s.field === 'phone' && !isReviewPhone(s.value)) return false;
      if (s.field === 'website' && !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(s.value ?? '')) return false;
      seen.add(key);
      return true;
    }
    if (s.field === 'linkedin_url') {
      if (!norm(s.name) || !/^https:\/\/www\.linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?$/.test(s.value ?? '')) return false;
      const key = suggestionKey(s);
      if (seen.has(key)) return false;
      seen.add(key);
      const same = contacts.find((c) => displayPersonKey(nameOf(c)) && displayPersonKey(nameOf(c)) === displayPersonKey(s.name));
      return !same || (!same.dismissed_at && !norm(same.linkedin_url));
    }
    if (!norm(s.name) || (s.field && s.field !== 'email') || (s.value !== undefined && !validEmail(norm(s.value)))) return false;
    const key = suggestionKey(s);
    if (seen.has(key)) return false;
    seen.add(key);
    const same = contacts.find((c) => displayPersonKey(nameOf(c)) && displayPersonKey(nameOf(c)) === displayPersonKey(s.name));
    return s.value ? !emails.has(norm(s.value)) && !(same && (same.dismissed_at || norm(same.email))) : !same;
  });
}

export type SuggestionAddPlan =
  | { kind: 'none' }
  | { kind: 'title_update'; id: string; patch: { title: string } }
  | { kind: 'linkedin_update'; id: string; patch: { linkedin_url: string } }
  | { kind: 'lead_update'; patch: { email: string } | { additional_emails: string[] } | { phone: string } | { owner_name: string } | { website: string } }
  | { kind: 'contact_update'; id: string; patch: { email: string; include_in_sequences: false } }
  | { kind: 'contact_insert'; patch: { source: 'manual'; kind: 'person'; first_name: string; last_name: string | null; title: string | null; email: string | null; linkedin_url?: string; include_in_sequences: false; is_primary: false } };

/** Plans only blank fills or new rows. The caller supplies lead_id/created_by from the signed-in session. */
export function planSuggestionAdd(s: ReviewSuggestion, lead: ReviewLead, contacts: ReviewContact[]): SuggestionAddPlan {
  if (!visibleSuggestions([s], lead, contacts).length) return { kind: 'none' };
  if (s.field === 'title') return { kind: 'title_update', id: contacts.find((c) => nameOf(c) === norm(s.name))!.id, patch: { title: s.value!.trim() } };
  if (s.field === 'phone') return { kind: 'lead_update', patch: { phone: s.value!.trim() } };
  if (s.field === 'owner_name') return { kind: 'lead_update', patch: { owner_name: s.value!.trim() } };
  if (s.field === 'website') return { kind: 'lead_update', patch: { website: s.value!.trim() } };
  if (s.field === 'linkedin_url') {
    const same = contacts.find((c) => displayPersonKey(nameOf(c)) && displayPersonKey(nameOf(c)) === displayPersonKey(s.name));
    if (same) return { kind: 'linkedin_update', id: same.id, patch: { linkedin_url: s.value! } };
    const [first, ...rest] = s.name.trim().split(/\s+/);
    return { kind: 'contact_insert', patch: { source: 'manual', kind: 'person', first_name: first!, last_name: rest.join(' ') || null,
      title: s.role?.trim() || null, email: null, linkedin_url: s.value!, include_in_sequences: false, is_primary: false } };
  }
  const email = norm(s.value);
  if (s.name.trim() === 'Company contact' && email) {
    return !norm(lead.email) ? { kind: 'lead_update', patch: { email } }
      : { kind: 'lead_update', patch: { additional_emails: [...strings(lead.additional_emails), s.value!.trim()] } };
  }
  const same = contacts.find((c) => displayPersonKey(nameOf(c)) && displayPersonKey(nameOf(c)) === displayPersonKey(s.name));
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

const plain = (v: unknown): string => typeof v === 'string' ? v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim() : '';

/** Owner-like titles only. Plain director, manager and head-of roles do not make someone the owner. */
export function isOwnerRole(role: unknown): boolean {
  const title = plain(role).replace(/[-/&,]/g, ' ');
  if (/\b(founder|ceo|chief executive|managing director|proprietor)\b/.test(title)) return true;
  return /\bowner\b/.test(title) && !/\b(product|scrum|process|account|service|system|data|technical|platform|project|risk)\s+owner\b/.test(title);
}

/** Role for a person from Deep find result entries (matched by accent-free name), else the contact's saved title. */
export function roleForPerson(name: string, entries: { name: string; role?: string | null }[], contacts: ReviewContact[] = []): string | null {
  const key = plain(name);
  if (!key) return null;
  const found = entries.find((e) => plain(e.name) === key && plain(e.role));
  if (found) return found.role!.trim();
  const contact = contacts.find((c) => plain(`${plain(c.first_name)} ${plain(c.last_name)}`) === key && plain(c.title));
  return contact ? String(contact.title).trim() : null;
}

/** New title for an existing contact, or null. Only an owner-like role upgrades a blank or non-owner-like title; never downgrades. */
export function planTitleUpgrade(contact: ReviewContact, role: string | null): string | null {
  if (contact.dismissed_at || !isOwnerRole(role)) return null;
  if (plain(contact.title) && isOwnerRole(contact.title)) return null;
  return role!.trim();
}

/** Full name to store as the lead owner, or null. Never replaces a non-blank owner and needs a known owner-like role. */
export function planOwnerFromSuggestion(s: ReviewSuggestion, role: string | null, lead: ReviewLead): string | null {
  const name = s.name.trim().replace(/\s+/g, ' ');
  if (!name || name === 'Company contact' || (s.field && s.field !== 'email')) return null;
  if (typeof lead.owner_name === 'string' && lead.owner_name.trim() !== '') return null;
  return isOwnerRole(role ?? s.role) ? name : null;
}
