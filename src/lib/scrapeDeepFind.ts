import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawLead } from '../types';
import { reviewRawIds } from './approveScrapeLead';

/** Deep find accepts saved leads. Resolving a reviewed scraper row never creates or approves a lead. */
export async function scrapeDeepFindLeadId(db: SupabaseClient, raw: RawLead, orgId: string): Promise<string> {
  if (raw.status !== 'approved') throw new Error('Approve this result into a pipeline before using Deep find.');
  const { data, error } = await db.from('leads').select('id').eq('org_id', orgId).in('raw_lead_id', reviewRawIds(raw)).limit(1);
  if (error || !data?.[0]) throw new Error('Could not find the approved lead. Refresh and try again.');
  return data[0].id;
}
