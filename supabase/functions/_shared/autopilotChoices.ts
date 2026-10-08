// Pure choices for the selected-leads autopilot: which sequence a lead goes
// into and which address an email goes to. No imports, so it runs in both
// Deno (edge functions) and Vitest.

const TIER_1 = /\b(owner|founder|co-founder|managing director|ceo|chief executive)\b/i;
const TIER_2 = /\bdirector\b/i;
const TIER_3 = /\b(head|manager)\b/i;
// Titles that look senior but are not the decision-maker: dropped to the last tier.
const DEMOTED = /\b(assistant|deputy|associate|account|non-executive|non executive)\b/i;
// No whitespace or <>,;: anywhere, a dotted domain, and a TLD of 2+ letters.
const PLAUSIBLE_EMAIL = /^[^\s@<>,;:]+@([^\s@<>,;:.]+\.)+[a-z]{2,}$/i;

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

/** Seniority tier of a job title: 1 (best) to 4 (everything else, demoted titles). */
function tierOf(title: string | null): number {
  const t = title ?? '';
  if (DEMOTED.test(t)) return 4;
  if (TIER_1.test(t)) return 1;
  if (TIER_2.test(t)) return 2;
  if (TIER_3.test(t)) return 3;
  return 4;
}

/**
 * Chooses the sequence to enrol a lead in.
 * 1. The sequence the lead is already enrolled in wins, even if it is no longer
 *    in `sequences` (the engine keeps continuing an existing enrolment).
 * 2. Otherwise the AI's pick, only if it is a real id in `sequences`.
 * 3. Otherwise the first sequence whose `icp_id` equals the lead's `icpId`
 *    (skipped when the lead has no icp, so null never matches null).
 * 4. Otherwise null. Empty or whitespace-only ids are treated as null.
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
 * True for a general contact copied over from the old "additional emails" list
 * (label 'Additional email') or a manual general row excluded from sequences.
 * These rank below the lead's own email. Keep in sync with `_shared/contacts.ts`.
 */
function isLegacyGeneral(c: {
  kind?: string;
  label?: string | null;
  source?: string;
  include_in_sequences?: boolean;
}): boolean {
  if (c.kind !== 'general') return false;
  if ((c.label ?? '').trim().toLowerCase() === 'additional email') return true;
  return c.source === 'manual' && c.include_in_sequences === false;
}

/**
 * Chooses who an email goes to. Order of preference:
 * 1. A usable contact marked `is_primary` (person or general inbox).
 * 2. The most senior named person with a plausible email, by tiered seniority
 *    of title: owner/founder/MD/CEO, then director, then head/manager, then
 *    everyone else (assistant, deputy, associate, account and non-executive
 *    titles are demoted to the last tier). Ties keep input order. A candidate
 *    without `kind` counts as a person.
 * 3. A general inbox the user added themselves (first in input order).
 * 4. The lead's own email, if valid.
 * 5. A migrated legacy general row ('Additional email' or manual and excluded
 *    from sequences), then null.
 * Dismissed candidates and candidates without a plausible email are skipped.
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
    is_primary?: boolean;
    kind?: string;
    label?: string | null;
    source?: string;
    include_in_sequences?: boolean;
  }[],
): { email: string; candidateId: string | null } | null {
  let primary: { id: string; email: string } | null = null;
  let person: { id: string; email: string; tier: number } | null = null;
  let curated: { id: string; email: string } | null = null;
  let legacy: { id: string; email: string } | null = null;
  for (const c of candidates) {
    if (c.dismissed_at != null) continue;
    const email = validEmail(c.email);
    if (!email) continue;
    if (c.is_primary === true) {
      if (!primary) primary = { id: c.id, email };
      continue;
    }
    if (c.kind === 'general') {
      if (isLegacyGeneral(c)) legacy = legacy ?? { id: c.id, email };
      else curated = curated ?? { id: c.id, email };
      continue;
    }
    const tier = tierOf(c.title);
    // Strictly better only, so the first of equal tiers (input order) wins.
    if (!person || tier < person.tier) person = { id: c.id, email, tier };
  }
  if (primary) return { email: primary.email, candidateId: primary.id };
  if (person) return { email: person.email, candidateId: person.id };
  if (curated) return { email: curated.email, candidateId: curated.id };

  const own = validEmail(leadEmail);
  if (own) return { email: own, candidateId: null };
  return legacy ? { email: legacy.email, candidateId: legacy.id } : null;
}
