import type { EmailAttachment } from './emailAttachments';

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
export interface DraftTarget { key: string; email: string; name: string | null }

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

/** All the placeholders still unfilled across the given recipients' drafts, de-duplicated. */
export function unionMissing(targets: DraftTarget[], drafts: Record<string, RecipientDraft>): string[] {
  return [...new Set(targets.flatMap((t) => drafts[t.key]?.missing ?? []))];
}
