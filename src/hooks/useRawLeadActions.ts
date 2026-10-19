import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { RawLead } from '../types';
import { approveScrapeLead, rejectScrapeLead } from '../lib/approveScrapeLead';

/** Approve/reject/skip a raw_leads row. Enrichment now starts from approved leads through Deep find. */
export function useRawLeadActions(jobOrgId?: string, pipelineId?: string, jobIcpId?: string | null, country?: string) {
  const { session } = useAuth();

  const approve = useCallback(async (lead: RawLead): Promise<string | null> => {
    return approveScrapeLead(supabase, lead, { orgId: jobOrgId, pipelineId, icpId: jobIcpId, userId: session?.user.id, country });
  }, [jobOrgId, pipelineId, jobIcpId, session, country]);

  const reject = useCallback(async (lead: RawLead): Promise<string | null> => {
    return rejectScrapeLead(supabase, lead);
  }, []);

  const skip = useCallback(async (): Promise<string | null> => {
    return null; // "Skip" is a no-op — the row simply stays status='pending' for a later session.
  }, []);

  return { approve, reject, skip };
}
