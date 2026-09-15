import type { Lead } from '../types';

export interface ForkedLeadRow {
  business_name: string;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  postcode: string | null;
  google_rating: number | null;
  review_count: number | null;
  vertical: string | null;
  stage: Lead['stage'];
  package_tier: Lead['package_tier'];
  deal_value: number | null;
  next_action_date: string | null;
  next_action_note: string | null;
  is_priority: boolean;
  kanban_position: number;
  org_id: string;
  pipeline_id: string;
  created_by: string;
  forked_from_lead_id: string;
}

/**
 * Builds insert rows for a pipeline fork: copies each source lead's working data
 * into the new pipeline/org. Deliberately resets assigned_to, call_count,
 * last_contacted_at, and raw_lead_id — those describe the SOURCE side's own work
 * history and scraper provenance, not something that should carry into an
 * independent copy — and records forked_from_lead_id for pure traceability (never a
 * live link; nothing here or later syncs back to the source).
 */
export function buildForkedLeadRows(
  sourceLeads: Lead[],
  newPipelineId: string,
  newOrgId: string,
  forkerId: string,
): ForkedLeadRow[] {
  return sourceLeads.map((lead) => ({
    business_name: lead.business_name,
    owner_name: lead.owner_name,
    phone: lead.phone,
    email: lead.email,
    website: lead.website,
    address: lead.address,
    city: lead.city,
    postcode: lead.postcode,
    google_rating: lead.google_rating,
    review_count: lead.review_count,
    vertical: lead.vertical,
    stage: lead.stage,
    package_tier: lead.package_tier,
    deal_value: lead.deal_value,
    next_action_date: lead.next_action_date,
    next_action_note: lead.next_action_note,
    is_priority: lead.is_priority,
    kanban_position: lead.kanban_position,
    org_id: newOrgId,
    pipeline_id: newPipelineId,
    created_by: forkerId,
    forked_from_lead_id: lead.id,
  }));
}
