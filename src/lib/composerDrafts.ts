import type { EmailAttachment } from './emailAttachments';
import { NEUTRAL_GREETING } from './composerRecipients';
import type { RecipientKind } from './composerRecipients';

/** One recipient's own email while it is being written: each person ticked gets their own. */
export interface RecipientDraft {
  subject: string;
  body: string;
  attachments: EmailAttachment[];
  /** The text before the AI rewrote it, for the "template to AI changes" diff. */
  baseBody: string | null;
  showDiff: boolean;
  /** Placeholders with no value, e.g. {{google_meet_link}}. */
  missing: string[];
}

export const BLANK_DRAFT: RecipientDraft = { subject: '', body: '', attachments: [], baseBody: null, showDiff: false, missing: [] };

/** Key for a draft opened from the review queue before its recipient has been worked out. */
export const SEED_KEY = '__draft';

/** A target of the email: its draft key plus what's needed to name it in messages. */
export interface DraftTarget { key: string; email: string; name: string | null; kind?: RecipientKind }

/** The greeting placeholder; a general inbox has no first name, so it gets a neutral word instead. */
const GREETING_VAR = 'first_name';

/** Returns a copy of the drafts with `patch` applied to one recipient's draft (creating it if needed). */
export function patchDraft(
  drafts: Record<string, RecipientDraft>,
  key: string,
  patch: Partial<RecipientDraft>,
): Record<string, RecipientDraft> {
  return { ...drafts, [key]: { ...(drafts[key] ?? BLANK_DRAFT), ...patch } };
}

/**
 * Checks every target has a finished email before saving/sending. Returns an error naming
 * the first person whose subject or body is empty, or null if all are ready. Matters now that
 * each recipient has their own: a missing one must not silently get skipped or sent blank.
 */
export function firstIncompleteDraft(targets: DraftTarget[], drafts: Record<string, RecipientDraft>): string | null {
  for (const t of targets) {
    const d = drafts[t.key];
    if (!d || !d.subject.trim() || !d.body.trim()) {
      const who = t.name ?? t.email;
      return targets.length > 1
        ? `There's no email written for ${who} yet. Use a template or AI above, or write one.`
        : 'Subject and body are required.';
    }
  }
  return null;
}

/**
 * All the placeholders still unfilled across the given recipients' drafts, de-duplicated.
 * A general inbox is greeted with a neutral word ("Hi there"), so a missing first name is
 * not reported for it and never blocks anything. Person and lead recipients are unchanged.
 */
export function unionMissing(targets: DraftTarget[], drafts: Record<string, RecipientDraft>): string[] {
  return [...new Set(targets.flatMap((t) => (
    (drafts[t.key]?.missing ?? []).filter((m) => !(t.kind === 'general' && m === GREETING_VAR))
  )))];
}

/**
 * The recipient details sent to generate-email so the email is written for them. A named
 * contact gets their own name and job title; a general inbox gets the neutral greeting
 * word and no title; the lead's own and legacy addresses keep the lead's default contact.
 */
export function generationIdentity(
  t: { candidateId: string | null; kind?: RecipientKind; name: string | null; title: string | null } | null,
): { recipient_name: string | undefined; recipient_title: string | undefined } {
  if (t?.kind === 'general') return { recipient_name: NEUTRAL_GREETING, recipient_title: undefined };
  return {
    recipient_name: t?.candidateId ? (t.name ?? undefined) : undefined,
    recipient_title: t?.candidateId ? (t.title ?? undefined) : undefined,
  };
}
