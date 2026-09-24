import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type ApiProvider = 'gemini' | 'google_places' | 'google_places_pro' | 'companies_house' | 'apollo' | 'hunter' | 'anthropic' | 'opencorporates';

const GLOBAL_ENV_VARS: Record<ApiProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  google_places: 'GOOGLE_PLACES_API_KEY',
  companies_house: 'COMPANIES_HOUSE_API_KEY',
  // apollo/hunter/google_places_pro map to env vars that are never configured
  // as secrets on this project, by design — Deno.env.get() returns undefined
  // for them no matter what, so resolveOrgApiKey() below always returns null
  // for these unless the org has its own key, regardless of
  // use_global_api_fallback. Paid providers must never fall back to Kevin's
  // account. google_places_pro also has no consuming feature yet (2026-09-24)
  // — the key can be configured ahead of time, but nothing reads it until a
  // future Places API (New) scraper source is built.
  apollo: 'APOLLO_API_KEY',
  hunter: 'HUNTER_API_KEY',
  google_places_pro: 'GOOGLE_PLACES_PRO_API_KEY',
  // anthropic follows the Gemini/Places/Companies-House tier instead — it's a
  // real, configured global secret, so Mr Brush & Co / DI Dreamlabs (the two
  // orgs with use_global_api_fallback=true) get outreach AI without setting
  // up their own key, matching how Gemini already works for them.
  anthropic: 'ANTHROPIC_API_KEY',
  // Free-tier provider, same fallback tier as companies_house/gemini/places
  // — Kevin's own 2 orgs can use a shared key here if one is ever
  // configured (unlike apollo/hunter, which never fall back for anyone).
  opencorporates: 'OPENCORPORATES_API_KEY',
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
