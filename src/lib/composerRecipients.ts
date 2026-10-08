import { contactDisplayName, isUsable, mainContact } from '../../supabase/functions/_shared/contacts';
import type { Contact } from '../../supabase/functions/_shared/contacts';

/** What the email is addressed to: the lead's own address, a legacy extra address, a named person, or a shared inbox. */
export type RecipientKind = 'lead' | 'extra' | 'person' | 'general';

/** A selectable send target. `candidateId` is the contact row id (null for the lead's own and legacy extra addresses). */
export interface Recipient {
  key: string;
  email: string;
  label: string;
  candidateId: string | null;
  name: string | null;
  title: string | null;
  kind: RecipientKind;
}

/** The lead fields the recipient list needs. */
export interface RecipientLead {
  email: string | null;
  owner_name: string | null;
  business_name: string;
  additional_emails?: string[] | null;
}

const lower = (email: string): string => email.trim().toLowerCase();

/**
 * Everyone the composer can write to, one entry per address (compared ignoring case).
 * Order: the lead's own email, legacy additional emails, then usable contacts (people
 * and general inboxes, never dismissed or invalid). A contact wins over the lead or
 * legacy entry for the same address so the contact id is recorded on the email.
 * Keys are stable: `lead`, `extra:<email>`, or the contact id.
 */
export function buildRecipients(lead: RecipientLead, contacts: Contact[]): Recipient[] {
  const usable = contacts.filter(isUsable);
  const covered = new Set(usable.map((c) => lower(c.email as string)));
  const seen = new Set<string>();
  const list: Recipient[] = [];

  const lead_ = lead.email?.trim();
  if (lead_ && !covered.has(lower(lead_))) {
    seen.add(lower(lead_));
    list.push({
      key: 'lead', email: lead.email as string, label: `${lead.owner_name ?? lead.business_name} (${lead.email})`,
      candidateId: null, name: lead.owner_name ?? null, title: null, kind: 'lead',
    });
  }
  for (const extra of lead.additional_emails ?? []) {
    const e = lower(extra);
    if (!e || seen.has(e) || covered.has(e)) continue;
    seen.add(e);
    list.push({ key: `extra:${extra}`, email: extra, label: `${extra} (additional)`, candidateId: null, name: null, title: null, kind: 'extra' });
  }
  for (const c of usable) {
    const e = lower(c.email as string);
    if (seen.has(e)) continue;
    seen.add(e);
    const email = (c.email as string).trim();
    const display = contactDisplayName(c);
    const isGeneral = c.kind === 'general';
    const title = c.title?.trim() || null;
    const name = isGeneral ? null : [c.first_name?.trim(), c.last_name?.trim()].filter(Boolean).join(' ') || null;
    list.push({
      key: c.id, email, candidateId: c.id, name, title: isGeneral ? null : title, kind: isGeneral ? 'general' : 'person',
      label: `${display}${!isGeneral && title ? ` · ${title}` : ''} (${email})`,
    });
  }
  return list;
}

/**
 * The keys ticked by default: the main contact (`mainContact`), matched to its
 * recipient by address. With no contacts this is the lead's own email, as it always
 * was; with nothing usable at all it is empty.
 */
export function defaultSelection(recipients: Recipient[], contacts: Contact[], leadEmail: string | null): string[] {
  const main = mainContact(contacts, leadEmail);
  const hit = main ? recipients.find((r) => lower(r.email) === main.email) : undefined;
  if (hit) return [hit.key];
  return recipients.some((r) => r.key === 'lead') ? ['lead'] : [];
}

/**
 * Which recipient an existing draft was written for. The draft's contact counts only while
 * that contact still has the address the draft was sent to; otherwise whoever listed has the
 * draft's address. Null when neither matches, so nothing is pre-selected rather than
 * guessing the wrong person.
 */
export function draftRecipientKey(
  draft: { to_email: string; decision_maker_candidate_id: string | null },
  recipients: Recipient[],
): string | null {
  const to = lower(draft.to_email);
  if (draft.decision_maker_candidate_id) {
    const byId = recipients.find((r) => r.candidateId === draft.decision_maker_candidate_id);
    if (byId && lower(byId.email) === to) return byId.key;
  }
  return recipients.find((r) => lower(r.email) === to)?.key ?? null;
}
