import { PACKAGE_TIERS } from './utils';
import type { AdditionalDetail } from './enrichmentGrouping';
import type { DreamAgentAction, DreamAgentUpdatePatch, Lead, PackageTier, Stage } from '../types';

const STAGE_VALUES = new Set<Stage>([
  'new_lead', 'contacted', 'audit_booked', 'proposal_sent',
  'negotiating', 'won', 'lost', 'not_now_nurture',
]);
const DEFAULT_PACKAGE_VALUES = new Set<PackageTier>(PACKAGE_TIERS.map((t) => t.value));
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT_LEN = 500;
// company_context is meant to hold a few paragraphs (see OrganizationSettings'
// own copy) — much longer than any other free-text field this sanitizer handles.
const MAX_COMPANY_CONTEXT_LEN = 4000;

function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function sanitizedString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_LEN) : undefined;
}

function sanitizePatch(raw: unknown, allowedPackages: Set<PackageTier>): DreamAgentUpdatePatch {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const patch: DreamAgentUpdatePatch = {};
  if (typeof r.stage === 'string' && STAGE_VALUES.has(r.stage as Stage)) patch.stage = r.stage as Stage;
  if (typeof r.package_tier === 'string' && allowedPackages.has(r.package_tier)) patch.package_tier = r.package_tier;
  if (typeof r.deal_value === 'number' && Number.isFinite(r.deal_value) && r.deal_value >= 0) patch.deal_value = r.deal_value;
  if (typeof r.next_action_date === 'string' && isValidDateOnly(r.next_action_date)) patch.next_action_date = r.next_action_date;
  const nextActionNote = sanitizedString(r.next_action_note);
  if (nextActionNote !== undefined) patch.next_action_note = nextActionNote;
  const painPoint = sanitizedString(r.pain_point);
  if (painPoint !== undefined) patch.pain_point = painPoint;
  for (const key of CONTACT_KEYS) {
    const value = sanitizedString(r[key])?.trim();
    if (value) patch[key] = value;
  }
  return patch;
}

const CONTACT_KEYS = ['owner_name', 'phone', 'email', 'website', 'address', 'city', 'postcode', 'vertical'] as const;
/** Fields with an additional_* list on the lead: a differing value is kept there, not lost. */
const ADDITIONAL_CAPABLE = ['owner_name', 'phone', 'email', 'website'] as const;

type ContactKey = (typeof CONTACT_KEYS)[number];

/**
 * What a note's contact details should do to an EXISTING lead. A note is often
 * jotted down quickly, so it must never clobber details the lead already has:
 *  - field blank on the lead                          -> `fill` it in
 *  - owner/phone/email/website already set, differing -> `additions` (kept as an
 *    additional detail; the primary value stays)
 *  - address/city/postcode/vertical already set       -> left alone
 *  - identical to what's there (any case)             -> nothing
 * `lead` is undefined only for a brand-new lead, where everything counts as blank.
 */
export function splitContactPatch(
  lead: Lead | undefined,
  patch: DreamAgentUpdatePatch,
): { fill: Partial<Record<ContactKey, string>>; additions: AdditionalDetail[] } {
  const fill: Partial<Record<ContactKey, string>> = {};
  const additions: AdditionalDetail[] = [];
  for (const key of CONTACT_KEYS) {
    const value = patch[key];
    if (!value) continue;
    const current = lead?.[key]?.trim() ?? '';
    if (!current) { fill[key] = value; continue; }
    if (current.toLowerCase() === value.trim().toLowerCase()) continue;
    if ((ADDITIONAL_CAPABLE as readonly string[]).includes(key)) additions.push({ field: key as AdditionalDetail['field'], value, source: 'note' });
  }
  return { fill, additions };
}

/**
 * Whitelist-validates parse-session-notes' raw response before it ever reaches
 * state or the UI — mirrors sanitizeSuggestion's established pattern for the
 * single-lead parse-notes flow. `validLeadIds` is the exact set of lead ids sent
 * to the AI in the lead index; any lead_id/candidate id outside that set is
 * dropped, never trusted — the AI is never a source of truth for which leads exist.
 */
export function sanitizeDreamAgentActions(raw: unknown, validLeadIds: Set<string>, allowedPackages: Set<PackageTier> = DEFAULT_PACKAGE_VALUES): DreamAgentAction[] {
  if (!Array.isArray(raw)) return [];
  const actions: DreamAgentAction[] = [];

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;

    if (r.type === 'update') {
      if (typeof r.lead_id !== 'string' || !validLeadIds.has(r.lead_id)) continue;
      const businessName = sanitizedString(r.business_name);
      if (businessName === undefined) continue;
      const excerpt = sanitizedString(r.excerpt) ?? '';
      const rationale = sanitizedString(r.rationale) ?? '';
      actions.push({ type: 'update', lead_id: r.lead_id, business_name: businessName, patch: sanitizePatch(r.patch, allowedPackages), excerpt, rationale });
      continue;
    }

    if (r.type === 'create') {
      if (typeof r.extracted !== 'object' || r.extracted === null) continue;
      const e = r.extracted as Record<string, unknown>;
      const businessName = sanitizedString(e.business_name);
      if (!businessName) continue;
      const excerpt = sanitizedString(r.excerpt) ?? '';
      const rationale = sanitizedString(r.rationale) ?? '';
      actions.push({
        type: 'create',
        extracted: {
          business_name: businessName,
          owner_name: sanitizedString(e.owner_name) ?? null,
          phone: sanitizedString(e.phone) ?? null,
          email: sanitizedString(e.email) ?? null,
          website: sanitizedString(e.website) ?? null,
          city: sanitizedString(e.city) ?? null,
          vertical: sanitizedString(e.vertical) ?? null,
          ...(sanitizedString(e.address) ? { address: sanitizedString(e.address) } : {}),
          ...(sanitizedString(e.postcode) ? { postcode: sanitizedString(e.postcode) } : {}),
        },
        // A new lead usually comes with what happened (visited → contacted, a
        // follow-up date…), which used to be dropped since only `update` had a patch.
        patch: sanitizePatch(r.patch, allowedPackages),
        excerpt, rationale,
      });
      continue;
    }

    if (r.type === 'ambiguous') {
      const mentionedText = sanitizedString(r.mentioned_text);
      if (mentionedText === undefined) continue;
      const rawCandidates = Array.isArray(r.candidate_lead_ids) ? r.candidate_lead_ids : [];
      const candidateIds = rawCandidates.filter((id): id is string => typeof id === 'string' && validLeadIds.has(id));
      if (candidateIds.length === 0) continue;
      const excerpt = sanitizedString(r.excerpt) ?? '';
      actions.push({ type: 'ambiguous', mentioned_text: mentionedText, candidate_lead_ids: candidateIds, excerpt });
      continue;
    }

    if (r.type === 'update_company_context') {
      const proposedContext = typeof r.proposed_context === 'string' ? r.proposed_context.trim().slice(0, MAX_COMPANY_CONTEXT_LEN) : undefined;
      if (!proposedContext) continue;
      const excerpt = sanitizedString(r.excerpt) ?? '';
      const rationale = sanitizedString(r.rationale) ?? '';
      actions.push({ type: 'update_company_context', proposed_context: proposedContext, excerpt, rationale });
      continue;
    }
  }

  return actions;
}
