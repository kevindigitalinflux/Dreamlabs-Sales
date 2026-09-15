import type { DreamAgentAction, DreamAgentUpdatePatch, PackageTier, Stage } from '../types';

const STAGE_VALUES = new Set<Stage>([
  'new_lead', 'contacted', 'audit_booked', 'proposal_sent',
  'negotiating', 'won', 'lost', 'not_now_nurture',
]);
const PACKAGE_TIER_VALUES = new Set<PackageTier>([
  'pilot_systems', 'pilot_ai_app', 'pilot_full_build',
  'automation_sprint', 'ai_foundation', 'full_build',
  'retainer_bronze', 'retainer_silver', 'retainer_gold', 'custom',
]);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT_LEN = 500;

function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function sanitizedString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_LEN) : undefined;
}

function sanitizePatch(raw: unknown): DreamAgentUpdatePatch {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const patch: DreamAgentUpdatePatch = {};
  if (typeof r.stage === 'string' && STAGE_VALUES.has(r.stage as Stage)) patch.stage = r.stage as Stage;
  if (typeof r.package_tier === 'string' && PACKAGE_TIER_VALUES.has(r.package_tier as PackageTier)) patch.package_tier = r.package_tier as PackageTier;
  if (typeof r.deal_value === 'number' && Number.isFinite(r.deal_value) && r.deal_value >= 0) patch.deal_value = r.deal_value;
  if (typeof r.next_action_date === 'string' && isValidDateOnly(r.next_action_date)) patch.next_action_date = r.next_action_date;
  const nextActionNote = sanitizedString(r.next_action_note);
  if (nextActionNote !== undefined) patch.next_action_note = nextActionNote;
  const painPoint = sanitizedString(r.pain_point);
  if (painPoint !== undefined) patch.pain_point = painPoint;
  return patch;
}

/**
 * Whitelist-validates parse-session-notes' raw response before it ever reaches
 * state or the UI — mirrors sanitizeSuggestion's established pattern for the
 * single-lead parse-notes flow. `validLeadIds` is the exact set of lead ids sent
 * to the AI in the lead index; any lead_id/candidate id outside that set is
 * dropped, never trusted — the AI is never a source of truth for which leads exist.
 */
export function sanitizeDreamAgentActions(raw: unknown, validLeadIds: Set<string>): DreamAgentAction[] {
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
      actions.push({ type: 'update', lead_id: r.lead_id, business_name: businessName, patch: sanitizePatch(r.patch), excerpt, rationale });
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
        },
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
  }

  return actions;
}
