// Pure planning for check-sequences: who a due sequence step is drafted for, and when the
// enrolment may advance. Only imports the equally pure `contacts.ts`, so it runs in both Deno
// (edge functions) and Vitest.
import { isUsable, sequenceRecipients, validEmail, type Contact } from './contacts.ts';

/** One email to draft for a due step. `contactId` is null for the lead's own email. */
export interface StepRecipient { email: string; contactId: string | null; name: string | null }

export interface StepPlan {
  /**
   * 'legacy_single': the lead has no usable contacts, so the step is drafted exactly as before
   * this feature (one draft to `lead.email`, no recipient naming, no contact id).
   * 'multi': one draft per recipient, main contact first.
   * 'none': nothing to draft. See `reason`.
   */
  kind: 'legacy_single' | 'multi' | 'none';
  recipients: StepRecipient[];
  /** True when the daily send cap cut the list short. */
  limitedByCap: boolean;
  /** Recipients before the cap was applied (0 for 'none'). */
  totalRecipients: number;
  /**
   * Only for 'none'. 'no_email': the lead has no email and no contact has one (the long-standing
   * "lead has no email" skip). 'no_recipients': the lead's own email is missing or vetoed by an excluded row and no contact is included, or
   * all addresses are unusable; the caller must pause the enrolment and leave a visible note.
   */
  reason?: 'no_email' | 'no_recipients' | 'opted_out';
}

/**
 * Decides who a due step is drafted for.
 * - Legacy: a lead with no contact rows at all and an email (even a malformed one, as before), or whose
 *   only recipient is its own valid email (no contact is curated), is drafted exactly as it always was.
 *   A lead WITH contact rows needs a valid own email to be used: an invalid own email plus no usable
 *   contact address is 'no_email' (skipped as before), never a draft to a broken address.
 * - Multi: otherwise every address `sequenceRecipients` returns, main contact first, cut to
 *   `capRemaining` drafts (null = no cap) so a multi-contact step cannot overshoot the daily cap.
 * - None: `sequenceRecipients` returned nothing. With no email anywhere that is the old skip; with
 *   addresses that are all excluded the caller must pause the enrolment and say so (never stall silently).
 */
export function planStepDrafts(input: {
  contacts: Contact[]; leadEmail: string | null; optedOut: boolean; capRemaining: number | null;
}): StepPlan {
  const { contacts, leadEmail, optedOut, capRemaining } = input;
  if (optedOut) return { kind: 'none', recipients: [], limitedByCap: false, totalRecipients: 0, reason: 'opted_out' };
  const own = leadEmail?.trim() ? leadEmail : null;
  const anyUsable = contacts.some(isUsable);
  const recipients = sequenceRecipients(contacts, leadEmail, optedOut);

  if (own && contacts.length === 0) {
    return { kind: 'legacy_single', recipients: [{ email: own, contactId: null, name: null }], limitedByCap: false, totalRecipients: 1 };
  }
  if (recipients.length === 0) {
    return { kind: 'none', recipients: [], limitedByCap: false, totalRecipients: 0, reason: anyUsable || validEmail(own) ? 'no_recipients' : 'no_email' };
  }
  if (recipients.length === 1 && recipients[0]!.contactId === null) {
    return { kind: 'legacy_single', recipients: [{ email: own ?? recipients[0]!.email, contactId: null, name: null }], limitedByCap: false, totalRecipients: 1 };
  }
  const limit = capRemaining === null || !Number.isFinite(capRemaining) ? recipients.length : Math.max(0, Math.floor(capRemaining));
  return { kind: 'multi', recipients: recipients.slice(0, limit), limitedByCap: limit < recipients.length, totalRecipients: recipients.length };
}

/**
 * Recipients that still need a draft for this step. `existingEmails` are the addresses of email_logs rows
 * of this enrolment created at or after the step's due time whose status is draft or sent (so a released
 * or sent copy of THIS step's draft counts; an earlier step's, created before the due time, does not).
 * Addresses compare case-insensitively and ignoring surrounding spaces.
 */
export function recipientsWithoutDraft(recipients: StepRecipient[], existingEmails: string[]): StepRecipient[] {
  const have = new Set(existingEmails.map((e) => e.trim().toLowerCase()));
  return recipients.filter((r) => !have.has(r.email.trim().toLowerCase()));
}

/**
 * The enrolment advances exactly once per step, and only when a draft exists (just created, or found
 * from an earlier partial run) for EVERY planned recipient. A partial result never advances: the next
 * run creates only the missing drafts.
 */
export function shouldAdvance(input: { planned: number; covered: number }): boolean {
  return input.planned > 0 && input.covered >= input.planned;
}

/**
 * What to do when the autopilot daily cap cannot cover every draft a step still needs.
 * 'all': fits (or no cap). 'defer': a full day's cap could cover them, so wait for tomorrow rather than
 * writing to only some contacts. 'truncate': even a full day's cap is too small, so write to `allow`
 * contacts (the caller leaves a lead note saying how many were skipped).
 */
export function capDecision(input: { needed: number; capRemaining: number | null; dailyCap: number | null }): { action: 'all' | 'defer' | 'truncate'; allow: number } {
  const { needed, capRemaining, dailyCap } = input;
  if (capRemaining === null || !Number.isFinite(capRemaining) || needed <= capRemaining) return { action: 'all', allow: needed };
  if (dailyCap !== null && dailyCap >= needed) return { action: 'defer', allow: 0 };
  return { action: 'truncate', allow: Math.max(0, Math.floor(capRemaining)) };
}

/** Note left when the daily cap is too small for every contact of a step. */
export function capLimitedNoteText(step: number, drafted: number, total: number): string {
  return `Sequence follow-up limited: step ${step} was drafted for ${drafted} of ${total} contacts because the daily send cap is too small to cover them all`;
}

/** True for the notes this feature writes itself; they are not human notes and must not feed AI drafts. */
export function isSequenceSystemNote(content: string): boolean {
  return content === NO_RECIPIENTS_NOTE_TEXT || content.startsWith('Sequence follow-up limited:');
}

/** Visible record left on the lead when a due step has nobody to write to. */
export const NO_RECIPIENTS_NOTE_TEXT = 'Sequence paused: no contact on this lead is set to receive follow-ups';

/** Text of the lead note that explains a paused enrolment. */
export function noRecipientsNoteText(): string {
  return NO_RECIPIENTS_NOTE_TEXT;
}

/** How a draft greets and describes one recipient. */
export interface RecipientNaming {
  /** Full name used as the lead's `owner_name` for this draft; null when no person is named. */
  ownerName: string | null;
  /** True for a shared inbox (or a person without a first name): the greeting is the neutral "there". */
  generalInbox: boolean;
  /** Job title, to tailor the angle; null for inboxes. */
  title: string | null;
}

/**
 * Naming for a contact recipient. A person with a first name is greeted by it; a shared inbox, or a
 * person known only by surname or label, gets the neutral greeting and no person is ever named.
 */
export function recipientNaming(c: Pick<Contact, 'kind' | 'first_name' | 'last_name' | 'title'>): RecipientNaming {
  if (c.kind === 'person') {
    const first = c.first_name?.trim() ?? '';
    if (first) {
      const last = c.last_name?.trim() ?? '';
      return { ownerName: last ? `${first} ${last}` : first, generalInbox: false, title: c.title?.trim() || null };
    }
  }
  return { ownerName: null, generalInbox: true, title: null };
}
