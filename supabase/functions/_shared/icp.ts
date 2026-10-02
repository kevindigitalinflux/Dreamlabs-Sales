// supabase/functions/_shared/icp.ts
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** An org's ideal customer profile (see migration 044). */
export interface IdealCustomerProfile {
  id: string;
  org_id: string;
  name: string;
  summary: string | null;
  pain_points: string | null;
  goals: string | null;
  objections: string | null;
  messaging_notes: string | null;
  extra_context: string | null;
}

/**
 * Which profile applies to an email: the lead's own first, then the template's, then the
 * sequence's. The first non-empty id wins.
 */
export function resolveIcpId(...ids: (string | null | undefined)[]): string | null {
  return ids.find((id) => typeof id === 'string' && id.length > 0) ?? null;
}

/**
 * Loads a profile, but only if it belongs to `orgId`. A template or lead can reference a
 * profile id, and this runs with the service role (RLS bypassed), so the org check here is
 * what stops one org's profile text ever being used in another org's emails.
 */
export async function loadIcp(service: SupabaseClient, orgId: string, icpId: string | null): Promise<IdealCustomerProfile | null> {
  if (!icpId) return null;
  const { data } = await service
    .from('ideal_customer_profiles').select('*').eq('id', icpId).eq('org_id', orgId).maybeSingle();
  return (data as IdealCustomerProfile | null) ?? null;
}

/** The first pain point (one per line, bullets/numbering stripped): what {{pain_point}} falls back to. */
export function topPainPoint(icp: Pick<IdealCustomerProfile, 'pain_points'> | null): string | null {
  const line = (icp?.pain_points ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .find((l) => l.length > 0);
  return line ?? null;
}

/** The profile as a labelled text block for an AI prompt. Empty fields are left out. */
export function formatIcpContext(icp: IdealCustomerProfile | null): string | null {
  if (!icp) return null;
  const parts: [string, string | null][] = [
    ['Who they are', icp.summary],
    ['Their pain points', icp.pain_points],
    ['What they want', icp.goals],
    ['Objections they raise', icp.objections],
    ['How to talk to them', icp.messaging_notes],
    ['Other context', icp.extra_context],
  ];
  const body = parts
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([label, v]) => `${label}:\n${v!.trim()}`)
    .join('\n\n');
  return `${icp.name}${body ? `\n\n${body}` : ''}`;
}
