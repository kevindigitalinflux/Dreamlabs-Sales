// Pure choices for the selected-leads autopilot: which sequence a lead goes
// into and which address an email goes to. No imports, so it runs in both
// Deno (edge functions) and Vitest.

const SENIORITY = /(owner|founder|managing director|ceo|chief executive|director|head|manager)/i;
const PLAUSIBLE_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Empty or whitespace-only strings count as missing. */
function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** Trimmed, lowercased email, or null when it is not a plausible address. */
function validEmail(value: string | null | undefined): string | null {
  const v = clean(value)?.toLowerCase() ?? null;
  return v && PLAUSIBLE_EMAIL.test(v) ? v : null;
}

/**
 * Chooses the sequence to enrol a lead in.
 * 1. The sequence the lead is already enrolled in wins, even if it is no longer
 *    in `sequences` (the engine keeps continuing an existing enrolment).
 * 2. Otherwise the AI's pick, only if it is a real id in `sequences`.
 * 3. Otherwise the first sequence whose `icp_id` equals the lead's `icpId`
 *    (skipped when the lead has no icp, so null never matches null).
 * 4. Otherwise null. Empty-string ids are treated as null.
 */
export function pickSequence(input: {
  enrolledSequenceId: string | null;
  aiPickedId: string | null;
  icpId: string | null;
  sequences: { id: string; icp_id: string | null }[];
}): string | null {
  const enrolled = clean(input.enrolledSequenceId);
  if (enrolled) return enrolled;

  const ai = clean(input.aiPickedId);
  if (ai && input.sequences.some((s) => s.id === ai)) return ai;

  const icp = clean(input.icpId);
  if (!icp) return null;
  return input.sequences.find((s) => clean(s.icp_id) === icp)?.id ?? null;
}

/**
 * Chooses who an email goes to. Candidates with a plausible email (and not
 * dismissed) are ranked by seniority of title, keeping input order for ties;
 * otherwise falls back to the lead's own email if valid, else null.
 * Emails are returned trimmed and lowercased; `candidateId` is null when the
 * lead's own email is used.
 */
export function pickRecipient(
  leadEmail: string | null,
  candidates: {
    id: string;
    title: string | null;
    email: string | null;
    dismissed_at?: string | null;
  }[],
): { email: string; candidateId: string | null } | null {
  const usable = candidates
    .filter((c) => c.dismissed_at == null)
    .map((c) => ({ id: c.id, email: validEmail(c.email), senior: SENIORITY.test(c.title ?? '') }))
    .filter((c): c is { id: string; email: string; senior: boolean } => c.email !== null);

  const best = usable.find((c) => c.senior) ?? usable[0];
  if (best) return { email: best.email, candidateId: best.id };

  const own = validEmail(leadEmail);
  return own ? { email: own, candidateId: null } : null;
}
