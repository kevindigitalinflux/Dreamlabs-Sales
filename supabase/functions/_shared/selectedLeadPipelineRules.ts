// Pure decision helpers for the selected-leads autopilot per-lead pipeline.
// No imports, so they run in both Deno (edge functions) and Vitest (src/lib tests).

/** Per-draft AI cost accounting: the same flat 1 cent check-sequences uses. */
export const DRAFT_COST_CENTS = 1;
/** One cheap Haiku sequence pick; counted as a flat 1 cent like a draft (integer cents). */
export const PICK_COST_CENTS = 1;

export interface SequenceStepLike { delay_days: number; template_type: string; template_id?: string | null; subject_override: string | null }

/**
 * Deno/Vitest copy of check-sequences' `advance` (itself a copy of advanceEnrollment in src/lib/sequenceMath.ts).
 * `currentStep` is the 1-based step that was JUST sent. Past the last step the enrolment completes and keeps its step number.
 */
export function nextEnrollmentState(currentStep: number, steps: { delay_days: number }[], now: Date): { current_step: number; next_send_at: string | null; status: 'active' | 'completed' } {
  const next = currentStep + 1;
  if (next > steps.length) return { current_step: currentStep, next_send_at: null, status: 'completed' };
  return { current_step: next, next_send_at: new Date(now.getTime() + steps[next - 1]!.delay_days * 86_400_000).toISOString(), status: 'active' };
}

/** Text for leads.next_action_note: `next` is the 1-based step now due. */
export function followUpNote(next: number, total: number): string {
  return `Follow up: sequence step ${next} of ${total}`;
}

/** Candidate fields that decide how the email addresses its recipient. */
export interface RecipientCandidateNames { first_name: string | null; last_name: string | null; name_obfuscated: boolean }

/**
 * Template variables that must come from the chosen decision-maker rather than the lead.
 * Empty when no candidate was chosen (the lead's own owner_name then supplies first_name).
 * The full name is only used when the surname is real (Apollo hides it until revealed).
 */
export function recipientVarOverrides(candidate: RecipientCandidateNames | null): Record<string, string> {
  const first = candidate?.first_name?.trim();
  if (!candidate || !first) return {};
  const out: Record<string, string> = { first_name: first };
  const last = candidate.last_name?.trim();
  if (last && !candidate.name_obfuscated) out.owner_name = `${first} ${last}`;
  return out;
}

/** False only when the soft deadline has passed AND the send has not started. Once SMTP began, never give up. */
export function canSendNow(p: { deadlineMs: number; nowMs: number; sendStarted: boolean }): boolean {
  return p.sendStarted || p.nowMs < p.deadlineMs;
}

/**
 * Every placeholder name that would still be a problem in the final email: keys the variable map could not fill
 * (`missingKeys` from substituteVariables), any `{{name}}` left in the text, and a catch-all 'unknown' when stray
 * braces remain without a readable name. Deduplicated, in first-seen order.
 */
export function unfilledPlaceholderNames(subject: string, body: string, missingKeys: string[]): string[] {
  const text = `${subject} ${body}`;
  const names = new Set<string>(missingKeys);
  for (const m of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) names.add(m[1]!);
  if (names.size === 0 && /\{\{|\}\}/.test(text)) names.add('unknown');
  return [...names];
}

/** Plain-English park reason for unfilled placeholders. */
export function placeholderReason(names: string[]): string {
  return `Draft has an unfilled placeholder: ${names.map((n) => `{{${n}}}`).join(', ')}`;
}

/** First word of a full name, or null when there is none. The caller must never invent a fallback like "The". */
export function senderFirstName(fullName: string | null | undefined): string | null {
  return fullName?.trim().split(/\s+/)[0] || null;
}

/** True when the address or its domain is on the blocklist (entries trimmed and lower-cased, like classifyLead). */
export function isRecipientBlocked(email: string, blocked: Set<string>): boolean {
  const norm = new Set([...blocked].map((b) => b.trim().toLowerCase()));
  const e = email.trim().toLowerCase();
  const domain = e.split('@')[1];
  return norm.has(e) || (!!domain && norm.has(domain));
}

export interface TemplateLike { id: string; org_id: string | null; template_type: string; is_default: boolean }

/**
 * The template a step uses, exactly as check-sequences resolves it. A step naming a template id gets that one
 * (only if it belongs to this org or is shared/org-less). Otherwise the default template of the step's type,
 * the org's own before the shared one. Null when nothing matches.
 */
export function chooseTemplate<T extends TemplateLike>(templates: T[], step: { template_type: string; template_id?: string | null }, orgId: string): T | null {
  const visible = templates.filter((t) => t.org_id === orgId || t.org_id === null);
  if (step.template_id) return visible.find((t) => t.id === step.template_id) ?? null;
  const defaults = visible.filter((t) => t.template_type === step.template_type && t.is_default);
  return defaults.find((t) => t.org_id === orgId) ?? defaults.find((t) => t.org_id === null) ?? null;
}

/**
 * Faithful, id-based equivalent of the can_view_lead SQL function (migrations 018 and 023) for the run's creator
 * (the SQL uses auth.uid(), which the service role does not have). Admin of the org; or, in the default pipeline, an
 * org member who owns/was assigned the lead (or the lead has no creator); or, in a named pipeline, its owner or an
 * explicit share. Membership in the lead's org is required on top (autopilot never sends for a non member).
 */
export function canCreatorViewLead(p: {
  memberRole: string | null;
  pipeline: { is_default: boolean; created_by: string | null };
  leadCreatedBy: string | null;
  leadAssignedTo: string | null;
  shared: boolean;
  creatorId: string;
}): boolean {
  if (!p.memberRole) return false;
  if (p.memberRole === 'admin') return true;
  if (p.pipeline.is_default) return p.leadCreatedBy === null || p.leadCreatedBy === p.creatorId || p.leadAssignedTo === p.creatorId;
  return p.pipeline.created_by === p.creatorId || p.shared;
}

const isBlank = (v: unknown): boolean => typeof v !== 'string' ? v == null : v.trim() === '' || v.trim() === '—';

/** The safe fill-blank policy: found values only for fields that are blank on the lead. Never overwrites. */
export function fillBlankPatch(lead: Record<string, unknown>, found: Record<string, string | undefined>): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const field of ['email', 'phone', 'owner_name', 'website']) {
    const value = found[field];
    if (typeof value === 'string' && value.trim() && isBlank(lead[field])) patch[field] = value.trim();
  }
  return patch;
}

/**
 * Makes an error message safe and plain for a run-lead reason: web addresses (which can carry API keys in a query
 * string) are replaced, em/en dashes and arrows become commas or the word "to", and the text is cut to 300 characters.
 */
export function plainReason(raw: string, fallback = 'Unexpected error'): string {
  const text = raw
    .replace(/https?:\/\/\S+/gi, 'a web address')
    .replace(/\s*→\s*/g, ' to ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || fallback).slice(0, 300);
}
