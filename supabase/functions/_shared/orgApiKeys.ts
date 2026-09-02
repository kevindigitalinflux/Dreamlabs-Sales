import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type ApiProvider = 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter';

const GLOBAL_ENV_VARS: Record<ApiProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  google_places: 'GOOGLE_PLACES_API_KEY',
  companies_house: 'COMPANIES_HOUSE_API_KEY',
  // apollo/hunter map to env vars that are never configured as secrets on
  // this project, by design — Deno.env.get() returns undefined for them no
  // matter what, so resolveOrgApiKey() below always returns null for these
  // two unless the org has its own key, regardless of use_global_api_fallback.
  // Paid providers must never fall back to Kevin's account.
  apollo: 'APOLLO_API_KEY',
  hunter: 'HUNTER_API_KEY',
};

/**
 * Resolves the API key for an org + provider: the org's own Vault key if
 * configured, else the global env-var key IF the org is flagged to use the
 * global fallback. Returns null if no key is available either way — callers
 * must treat null as "this org needs to configure its own key" and degrade
 * gracefully, never throw.
 */
export async function resolveOrgApiKey(
  // deno-lint-ignore no-explicit-any
  service: SupabaseClient<any>, orgId: string, provider: ApiProvider,
): Promise<string | null> {
  const { data: settings } = await service
    .from('org_api_settings').select('is_configured').eq('org_id', orgId).eq('provider', provider).maybeSingle();
  if (settings?.is_configured) {
    const { data: key } = await service.rpc('app_get_org_api_key', { target_org: orgId, target_provider: provider });
    if (key) return key as string;
  }
  const { data: org } = await service.from('organizations').select('use_global_api_fallback').eq('id', orgId).single();
  if (org?.use_global_api_fallback) return Deno.env.get(GLOBAL_ENV_VARS[provider]) ?? null;
  return null;
}
