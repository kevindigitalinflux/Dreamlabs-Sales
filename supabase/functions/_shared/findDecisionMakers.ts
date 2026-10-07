// supabase/functions/_shared/findDecisionMakers.ts
// Moved unchanged from find-decision-makers/index.ts (the per-lead body) so the selected-leads autopilot can reuse it.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { bareDomain } from './domain.ts';
import { findHunterDecisionMakers } from './apolloHunterLookup.ts';
import { searchApolloDecisionMakers } from './apolloPeopleSearch.ts';

// A business usually has more than one decision-maker; keep the best few per source.
const MAX_PER_SOURCE = 3;

export interface DecisionMakerLead { id: string; org_id: string; website: string | null }

/**
 * Searches Hunter and Apollo (whichever keys are given) for a lead's decision-makers, stores new ones
 * (never overwriting existing rows), auto-captures LinkedIn contacts, and returns everyone stored for the
 * lead that has not been dismissed. `userId` is written to created_by. Empty when the lead has no website.
 */
export async function findAndStoreDecisionMakers(
  service: SupabaseClient,
  lead: DecisionMakerLead,
  keys: { hunterKey: string | null; apolloKey: string | null },
  userId: string,
): Promise<Record<string, unknown>[]> {
  const { hunterKey, apolloKey } = keys;
  const orgId = lead.org_id;
  const domain = bareDomain(lead.website ?? '');
  if (!domain) return [];

  const rows: Record<string, unknown>[] = [];

  if (hunterKey) {
    for (const hunter of await findHunterDecisionMakers(lead.website, hunterKey, MAX_PER_SOURCE)) {
      rows.push({
        lead_id: lead.id, source: 'hunter',
        first_name: hunter.firstName, last_name: hunter.lastName, title: hunter.title,
        email: hunter.email, email_revealed: true, name_obfuscated: false,
        linkedin_url: hunter.linkedinUrl,
        created_by: userId,
      });
    }
  }
  if (apolloKey) {
    for (const apollo of await searchApolloDecisionMakers(domain, apolloKey, MAX_PER_SOURCE)) {
      rows.push({
        lead_id: lead.id, source: 'apollo', apollo_person_id: apollo.apolloPersonId,
        first_name: apollo.firstName, last_name: apollo.lastNameObfuscated, title: apollo.title,
        name_obfuscated: true, email_revealed: false,
        linkedin_url: apollo.linkedinUrl,
        created_by: userId,
      });
    }
  }

  if (rows.length === 0) return [];

  // One row per person (Hunter by email, Apollo by person id) via the
  // generated dedupe_key (migration 039), so re-running never duplicates.
  // ignoreDuplicates (ON CONFLICT DO NOTHING) rather than an overwriting upsert:
  // an overwrite resets email_revealed/email on an Apollo contact whose email
  // was already paid for and revealed. Existing rows are left exactly as they are.
  const { error: upsertErr } = await service
    .from('decision_maker_candidates')
    .upsert(rows, { onConflict: 'lead_id,dedupe_key', ignoreDuplicates: true });
  if (upsertErr) return [];
  // Everyone stored for this lead (new and from earlier runs), not only this run's inserts.
  const { data: upserted } = await service
    .from('decision_maker_candidates').select('*').eq('lead_id', lead.id).is('dismissed_at', null).order('created_at');

  // Auto-capture: any candidate with a LinkedIn URL gets a linked
  // linkedin_contacts row immediately, so it shows up in the LinkedIn
  // queue without a separate action (matches the controller-approved
  // design: "automatic, as soon as found"). context_signal stays null --
  // see this plan's Global Constraints for why. Idempotent via the
  // unique index on decision_maker_candidate_id (Task 1; made non-partial
  // in migration 035 so PostgREST's onConflict inference can target it).
  for (const candidate of (upserted ?? []) as { id: string; first_name: string | null; last_name: string | null; linkedin_url: string | null }[]) {
    if (!candidate.linkedin_url) continue;
    const fullName = `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim() || 'Unknown';
    // Best-effort: auto-capture is additive, never load-bearing for the
    // decision-maker search itself (matches this plan's Error Handling
    // section and pipeline-shares' notifyShare pattern) -- log and move on
    // rather than failing the whole request.
    const { error: linkedinErr } = await service.from('linkedin_contacts').upsert({
      org_id: orgId,
      lead_id: lead.id,
      decision_maker_candidate_id: candidate.id,
      full_name: fullName,
      linkedin_url: candidate.linkedin_url,
      context_signal: null,
      created_by: userId,
    }, { onConflict: 'decision_maker_candidate_id' });
    if (linkedinErr) console.error('Failed to auto-capture linkedin_contacts row:', linkedinErr);
  }

  return (upserted ?? []) as Record<string, unknown>[];
}
