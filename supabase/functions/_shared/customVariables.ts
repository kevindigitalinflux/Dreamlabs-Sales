// supabase/functions/_shared/customVariables.ts
// Deno copy of the merge rule in src/lib/customVariables.ts: keep the two in sync.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Built-in placeholders whose value comes from the lead or the sender. A custom placeholder
 * can never replace one of these. (cal_link and audit_date are deliberately NOT here: they
 * are built-ins that nothing fills yet, so a user may define them.)
 */
export const RESERVED_KEYS = [
  'first_name', 'business_name', 'owner_name', 'package_name', 'deal_value',
  'contractor_name', 'pain_point', 'unsubscribe_url',
];

/**
 * The placeholders available to one email: the org's company-wide values plus the SENDER's
 * own personal ones (which override a company-wide value with the same key). `userId` is
 * the person who is sending: the signed-in user for a manual draft, the enrolling user for a
 * sequence step; null (system-generated) gets company-wide values only.
 * Runs with the service role, so it deliberately loads only those two scopes, never
 * another user's personal values.
 */
export async function loadCustomVariables(service: SupabaseClient, orgId: string, userId: string | null): Promise<Record<string, string>> {
  let query = service.from('custom_variables').select('key, value, user_id').eq('org_id', orgId);
  query = userId ? query.or(`user_id.is.null,user_id.eq.${userId}`) : query.is('user_id', null);
  const { data } = await query;
  const rows = (data as { key: string; value: string; user_id: string | null }[] | null) ?? [];
  const out: Record<string, string> = {};
  for (const r of rows) if (r.user_id === null) out[r.key] = r.value;     // company-wide first
  for (const r of rows) if (r.user_id !== null) out[r.key] = r.value;     // then personal overrides
  return out;
}

/**
 * Adds custom values to a template-variable map. A built-in that already has a value is
 * never overridden; a custom value fills a placeholder that is missing or blank.
 */
export function applyCustomVariables(
  vars: Record<string, string | null>,
  custom: Record<string, string>,
): Record<string, string | null> {
  const out = { ...vars };
  for (const [key, value] of Object.entries(custom)) {
    if (RESERVED_KEYS.includes(key)) continue;
    if (out[key] === null || out[key] === undefined || out[key] === '') out[key] = value;
  }
  return out;
}
