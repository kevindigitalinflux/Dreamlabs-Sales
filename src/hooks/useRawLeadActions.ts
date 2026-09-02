import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { RawLead } from '../types';

/** Approve/reject/skip a raw_leads row, plus the two paid enrichment actions. */
export function useRawLeadActions(jobOrgId?: string) {
  const { session } = useAuth();

  const approve = useCallback(async (lead: RawLead): Promise<string | null> => {
    if (!jobOrgId) return 'Could not determine the organization for this lead';
    const { error: insertErr } = await supabase.from('leads').insert({
      business_name: lead.business_name, owner_name: lead.owner_name, phone: lead.phone,
      email: lead.email, website: lead.website, address: lead.address, city: lead.city,
      postcode: lead.postcode, google_rating: lead.google_rating, review_count: lead.review_count,
      vertical: lead.vertical, stage: 'new_lead', org_id: jobOrgId,
      created_by: session?.user.id, raw_lead_id: lead.id,
    });
    if (insertErr) return insertErr.message;
    const { error: updateErr } = await supabase.from('raw_leads').update({
      status: 'approved', approved_by: session?.user.id, approved_at: new Date().toISOString(),
    }).eq('id', lead.id);
    return updateErr ? updateErr.message : null;
  }, [jobOrgId, session]);

  const reject = useCallback(async (lead: RawLead): Promise<string | null> => {
    const { error } = await supabase.from('raw_leads').update({ status: 'rejected' }).eq('id', lead.id);
    return error ? error.message : null;
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
