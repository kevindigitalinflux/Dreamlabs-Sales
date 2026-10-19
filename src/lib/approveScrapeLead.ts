import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawLead } from '../types';
import { mergeScrapeLeads, type MergedRawLead } from './scrapeMerge';

interface ApprovalContext { orgId?: string; pipelineId?: string; icpId?: string | null; userId?: string; country?: string }

export function reviewRawIds(lead: RawLead): string[] {
  return 'rawIds' in lead ? (lead as MergedRawLead).rawIds : [lead.id];
}

export async function approveScrapeLead(db: SupabaseClient, input: RawLead, context: ApprovalContext): Promise<string | null> {
  if (!context.orgId) return 'Could not determine the organization for this lead';
  if (!context.pipelineId) return 'Choose a pipeline before approving';
  const lead = 'members' in input ? input as MergedRawLead : mergeScrapeLeads([input])[0];
  const ids = reviewRawIds(lead);
  // Recovery after an insert succeeded but marking raw rows failed. Keep the original FK and officer trigger.
  const existing = await db.from('leads').select('id').eq('org_id', context.orgId).in('raw_lead_id', ids).limit(1);
  if (existing.error) return existing.error.message;
  if (!existing.data?.length) {
    // The INSERT trigger reads raw_data from the real registry row, not the browser's merged object.
    // Preserve original payloads on their rows and inside this snapshot; never fabricate a raw_lead_id.
    if (lead.members.length > 1) {
      const rawData = { ...lead.raw_data, merged_sources: lead.members.map((r) => ({ id: r.id, source: r.source, raw_data: r.raw_data })) };
      const saved = await db.from('raw_leads').update({ raw_data: rawData }).eq('id', lead.id).select('id');
      if (saved.error) return saved.error.message;
      if (!saved.data?.length) return 'You cannot update this search result';
    }
    const number = lead.source === 'companies_house' && /^([0-9]{8}|[A-Z]{2}[0-9]{6})$/.test(lead.companyNumber ?? '') ? lead.companyNumber : null;
    const { error } = await db.from('leads').insert({
      business_name: lead.business_name, owner_name: lead.owner_name, phone: lead.phone,
      email: lead.email, website: lead.website, address: lead.address, city: lead.city,
      postcode: lead.postcode, google_rating: lead.google_rating, review_count: lead.review_count,
      vertical: lead.vertical, stage: 'new_lead', org_id: context.orgId, pipeline_id: context.pipelineId,
      icp_id: context.icpId ?? null, // inherited from the search this lead was found by
      created_by: context.userId, raw_lead_id: lead.id,
      company_number: number, country: context.country === 'other' ? 'OTHER' : context.country ?? null,
    });
    if (error) return error.message;
  }
  const { error, data } = await db.from('raw_leads').update({
    status: 'approved', approved_by: context.userId, approved_at: new Date().toISOString(),
  }).in('id', ids).select('id');
  if (error) return error.message;
  return data?.length === ids.length ? null : 'Lead saved. Some source rows could not be marked approved. Retry to finish.';
}

export async function rejectScrapeLead(db: SupabaseClient, lead: RawLead): Promise<string | null> {
  const ids = reviewRawIds(lead);
  const { error, data } = await db.from('raw_leads').update({ status: 'rejected' }).in('id', ids).select('id');
  if (error) return error.message;
  return data?.length === ids.length ? null : 'Some source rows could not be rejected. Refresh and try again.';
}
