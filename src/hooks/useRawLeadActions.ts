import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { RawLead } from '../types';
import { approveScrapeLead, rejectScrapeLead } from '../lib/approveScrapeLead';

/** Approve/reject/skip a raw_leads row, plus the two paid enrichment actions. */
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

  const enrichWithApollo = useCallback(async (lead: RawLead): Promise<string | null> => {
    // No org_id sent — enrich-apollo derives it authoritatively from the lead
    // itself server-side (see Task 7), so there's nothing here to spoof.
    const { data, error } = await supabase.functions.invoke('enrich-apollo', {
      body: { raw_lead_id: lead.id },
    });
    if (error) return error.message;
    return (data as { error?: string }).error ?? null;
  }, []);

  const enrichWithHunter = useCallback(async (lead: RawLead): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke('enrich-hunter', {
      body: { raw_lead_id: lead.id },
    });
    if (error) return error.message;
    return (data as { error?: string }).error ?? null;
  }, []);

  return { approve, reject, skip, enrichWithApollo, enrichWithHunter };
}
