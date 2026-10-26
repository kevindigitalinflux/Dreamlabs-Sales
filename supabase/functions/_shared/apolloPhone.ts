import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { contactPhonePatch, parsePhone, phoneMetadata } from './phoneNumbers.ts';

/** Paid phone reveal is BYO only, even if a global key is added later. Fail closed on settings/Vault errors. */
export async function resolveOwnApolloKey(service: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await service.from('org_api_settings').select('is_configured').eq('org_id', orgId).eq('provider', 'apollo').maybeSingle();
  if (error || !data?.is_configured) return null;
  const key = await service.rpc('app_get_org_api_key', { target_org: orgId, target_provider: 'apollo' });
  return !key.error && typeof key.data === 'string' && key.data.trim() ? key.data : null;
}

/** Phone webhook data is untrusted; invalid first choices never hide a later usable business number. */
export function apolloPhoneEvidence(numbers: { raw_number?: string; type_cd?: string }[], country: unknown, foundAt: string) {
  const ranked = [...numbers].sort((a, b) => Number(b.type_cd === 'mobile') - Number(a.type_cd === 'mobile'));
  for (const candidate of ranked) {
    const parsed = parsePhone(candidate.raw_number, country);
    if (!parsed) continue;
    const kind = candidate.type_cd === 'mobile' || parsed.lineType === 'mobile' ? 'mobile' : 'direct';
    return phoneMetadata(candidate.raw_number, country, kind, 'apollo', null, foundAt)!;
  }
  return null;
}

/** Contact columns only; original text is retained separately in the owning lead's per-number metadata. */
export function apolloPhonePatch(numbers: { raw_number?: string; type_cd?: string }[], country: unknown, foundAt: string) {
  const phone = apolloPhoneEvidence(numbers, country, foundAt);
  return phone ? { ...contactPhonePatch(phone), phone_status: 'revealed' as const } : { phone_status: 'not_found' as const };
}
