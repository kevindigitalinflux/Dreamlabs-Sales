// Step 3: make sure the lead has a usable recipient, looking up details and decision-makers only if needed.
import { pickRecipient } from '../autopilotChoices.ts';
import { enrichOneLead, type EnrichLeadRow } from '../enrichLead.ts';
import { findAndStoreDecisionMakers } from '../findDecisionMakers.ts';
import { fillBlankPatch } from '../selectedLeadPipelineRules.ts';
import type { PipelineContext } from '../selectedLeadPipeline.ts';
import { loadCandidates } from './load.ts';
import { TIMEOUT_REASON, raceDeadline, type CandidateRow, type Lead, type OrgKeys, type Stop } from './types.ts';

export interface RecipientResult { lead: Lead; candidates: CandidateRow[]; recipient: { email: string; candidateId: string | null } }

const NO_EMAIL = 'No email found even after looking up details and decision-makers';
const OUT_OF_TIME: Stop = { stop: { outcome: 'needs_input', reason: TIMEOUT_REASON } };

/**
 * Picks who the email goes to. If nobody has a usable address: fills blank contact details (never overwrites),
 * then searches for decision-makers with the org's Hunter/Apollo keys, then tries again. Each lookup is best effort.
 */
export async function ensureRecipient(ctx: PipelineContext, keys: OrgKeys): Promise<RecipientResult | Stop> {
  let lead = ctx.lead;
  let candidates = await loadCandidates(ctx.service, lead.id);
  let recipient = pickRecipient((lead.email as string | null) ?? null, candidates);
  if (recipient) return { lead, candidates, recipient };

  if (Date.now() >= ctx.deadlineMs) return OUT_OF_TIME;
  try {
    const found = await raceDeadline(enrichOneLead(lead as unknown as EnrichLeadRow, keys), ctx.deadlineMs);
    const patch = found ? fillBlankPatch(lead, found.proposed) : {};
    if (Object.keys(patch).length > 0) {
      const { error } = await ctx.service.from('leads').update(patch).eq('id', lead.id).eq('org_id', ctx.run.org_id);
      if (error) console.error('autopilot: could not save found contact details');
      else lead = { ...lead, ...patch };
    }
  } catch { console.error('autopilot: detail lookup failed or timed out'); }
  recipient = pickRecipient((lead.email as string | null) ?? null, candidates);

  if (!recipient) {
    if (Date.now() >= ctx.deadlineMs) return OUT_OF_TIME;
    try {
      await raceDeadline(findAndStoreDecisionMakers(
        ctx.service, { id: lead.id, org_id: ctx.run.org_id, website: (lead.website as string | null) ?? null },
        { hunterKey: keys.hunter, apolloKey: keys.apollo }, ctx.run.created_by,
      ), ctx.deadlineMs);
    } catch { console.error('autopilot: decision-maker search failed or timed out'); }
    candidates = await loadCandidates(ctx.service, lead.id);
    recipient = pickRecipient((lead.email as string | null) ?? null, candidates);
  }
  if (!recipient) return { stop: { outcome: 'skipped', reason: NO_EMAIL } };
  return { lead, candidates, recipient };
}
