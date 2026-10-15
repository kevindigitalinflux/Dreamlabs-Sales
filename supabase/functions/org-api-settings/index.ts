import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { croRejectionMessage, searchCroCompanies, splitCroSecret } from '../_shared/cro.ts';
import { parseOrgWorkerSecret, sharedWorkerAllowed, validateWorkerConnection } from '../_shared/workerConfig.ts';
import { validateFirecrawlKey } from '../_shared/firecrawlClient.ts';

type Provider = 'gemini' | 'google_places' | 'google_places_pro' | 'companies_house' | 'apollo' | 'hunter' | 'anthropic' | 'opencorporates' | 'cro' | 'lookup_worker' | 'firecrawl';

async function validateKey(provider: Provider, key: string): Promise<string | null> {
  if (provider === 'lookup_worker') return validateWorkerConnection(key);
  if (provider === 'firecrawl') return validateFirecrawlKey(key);
  try {
    if (provider === 'gemini') {
      // Keep in sync with AI_MODEL in _shared/ai.ts — gemini-2.5-flash was
      // retired by Google; using a dead model here would reject every valid key.
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }] }) },
      );
      return res.ok ? null : `Gemini rejected the key (HTTP ${res.status})`;
    }
    if (provider === 'google_places') {
      const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=test&key=${key}`);
      const data = await res.json() as { status?: string };
      return data.status === 'REQUEST_DENIED' || data.status === 'INVALID_REQUEST' ? `Google rejected the key (${data.status})` : null;
    }
    if (provider === 'google_places_pro') {
      // Places API (New) bills per field requested — "places.id" alone stays
      // in the free "Essentials (IDs only)" tier, so validating a key here
      // never costs anything, unlike an actual search with rating/phone/etc.
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id' },
        body: JSON.stringify({ textQuery: 'test' }),
      });
      return res.ok ? null : `Google rejected the key (HTTP ${res.status})`;
    }
    if (provider === 'companies_house') {
      const res = await fetch('https://api.company-information.service.gov.uk/search/companies?q=test', {
        headers: { Authorization: 'Basic ' + btoa(`${key}:`) },
      });
      return res.ok ? null : `Companies House rejected the key (HTTP ${res.status})`;
    }
    if (provider === 'apollo') {
      // Free health-check endpoint — does not consume Apollo credits. It always
      // returns HTTP 200 regardless of key validity (it's a service health
      // check, not a key-auth check) — the real signal is the is_logged_in
      // field in the response body, confirmed live 2026-09-02 against a
      // deliberately invalid key ({"healthy":true,"is_logged_in":false}, HTTP 200).
      const res = await fetch('https://api.apollo.io/api/v1/auth/health', {
        headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
      });
      if (!res.ok) return `Apollo rejected the key (HTTP ${res.status})`;
      const data = await res.json() as { is_logged_in?: boolean };
      return data.is_logged_in ? null : 'Apollo rejected the key (invalid API key)';
    }
    if (provider === 'anthropic') {
      // A trivial 1-token request is the standard way to validate a Claude
      // key — there's no dedicated health-check endpoint. Cheapest possible
      // real call: Haiku, max_tokens 1.
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] }),
      });
      return res.ok ? null : `Anthropic rejected the key (HTTP ${res.status})`;
    }
    if (provider === 'opencorporates') {
      const res = await fetch(`https://api.opencorporates.com/v0.4/companies/search?q=test&api_token=${key}`);
      return res.ok ? null : `OpenCorporates rejected the key (HTTP ${res.status})`;
    }
    if (provider === 'cro') {
      // Stored as one "email:apiKey" string; split on the FIRST colon (the key may itself contain colons).
      const creds = splitCroSecret(key);
      if (!creds) return 'Enter your CRO email and key as email:key';
      try {
        await searchCroCompanies('test', 1, creds);
        return null;
      } catch (e) {
        const rejection = croRejectionMessage(e);
        if (rejection) return rejection;
        throw e;
      }
    }
    // hunter — /v2/account is Hunter's free account-info call, used purely to verify the key.
    const res = await fetch(`https://api.hunter.io/v2/account?api_key=${key}`);
    return res.ok ? null : `Hunter rejected the key (HTTP ${res.status})`;
  } catch (e) {
    return 'Could not reach the provider to validate the key: ' + (e instanceof Error ? e.message : String(e));
  }
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const authHeader = req.headers.get('Authorization') ?? '';
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await anonClient.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const body = (await req.json()) as Record<string, unknown>;
  const orgId = String(body.org_id ?? '');
  if (!orgId) return json({ error: 'org_id is required' }, 400, headers);

  const { data: membership } = await service
    .from('org_members').select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  const { data: profile } = await service.from('profiles').select('platform_role').eq('id', userData.user.id).single();
  const isMember = !!membership || profile?.platform_role === 'platform_admin';
  const canManage = membership?.role === 'admin' || profile?.platform_role === 'platform_admin';
  if (!isMember) return json({ error: 'Not a member of this organization' }, 403, headers);

  if (body.action === 'get') {
    const { data, error } = await service.from('org_api_settings').select('provider, is_configured').eq('org_id', orgId);
    if (error) return json({ error: error.message }, 400, headers);
    const { data: org, error: orgError } = await service.from('organizations').select('use_global_api_fallback').eq('id', orgId).single();
    if (orgError) return json({ error: 'Could not load worker settings.' }, 500, headers);
    let workerHost: string | null = null;
    if (membership?.role === 'admin' && data?.some((s) => s.provider === 'lookup_worker' && s.is_configured)) {
      const { data: value, error: vaultError } = await service.rpc('app_get_org_api_key', { target_org: orgId, target_provider: 'lookup_worker' });
      if (vaultError) return json({ error: 'Could not load worker settings.' }, 500, headers);
      const config = parseOrgWorkerSecret(typeof value === 'string' ? value : null);
      workerHost = config ? new URL(config.url).host : null;
    }
    return json({ settings: data, worker_host: workerHost, shared_worker_allowed: sharedWorkerAllowed(orgId, org?.use_global_api_fallback === true, Deno.env.get('WORKER_SHARED_ORG_IDS')), use_global_api_fallback: org?.use_global_api_fallback === true }, 200, headers);
  }

  if (body.action === 'remove') {
    if (!canManage) return json({ error: 'Org admin only' }, 403, headers);
    if (membership?.role !== 'admin') return json({ error: 'An admin of this organisation must manage its worker.' }, 403, headers);
    if (body.provider !== 'lookup_worker') return json({ error: 'Invalid provider' }, 400, headers);
    // Clear Vault first; a partial failure fails closed instead of reusing an old credential.
    const { error: vaultError } = await service.rpc('app_set_org_api_key', { target_org: orgId, target_provider: 'lookup_worker', secret: '' });
    if (vaultError) return json({ error: 'Could not remove the worker connection.' }, 500, headers);
    const { error } = await service.from('org_api_settings').update({ is_configured: false, updated_at: new Date().toISOString() })
      .eq('org_id', orgId).eq('provider', 'lookup_worker');
    if (error) return json({ error: 'Could not remove the worker connection.' }, 500, headers);
    return json({ ok: true }, 200, headers);
  }

  if (body.action === 'save') {
    if (!canManage) return json({ error: 'Org admin only' }, 403, headers);
    const provider = String(body.provider ?? '') as Provider;
    const apiKey = String(body.api_key ?? '').trim();
    // Architect ruling: worker and Firecrawl management require admin membership of this organisation.
    if ((provider === 'lookup_worker' || provider === 'firecrawl') && membership?.role !== 'admin')
      return json({ error: 'An admin of this organisation must manage this provider.' }, 403, headers);
    if (!['gemini', 'google_places', 'google_places_pro', 'companies_house', 'apollo', 'hunter', 'anthropic', 'opencorporates', 'cro', 'lookup_worker', 'firecrawl'].includes(provider)) return json({ error: 'Invalid provider' }, 400, headers);
    if (!apiKey) return json({ error: 'api_key is required' }, 400, headers);

    const validationError = await validateKey(provider, apiKey);
    if (validationError) return json({ error: validationError }, 400, headers);

    const { error: vaultErr } = await service.rpc('app_set_org_api_key', { target_org: orgId, target_provider: provider, secret: apiKey });
    if (vaultErr) return json({ error: 'Could not store the key.' }, 500, headers);
    const { error: upsertErr } = await service.from('org_api_settings').upsert(
      { org_id: orgId, provider, is_configured: true, updated_at: new Date().toISOString() },
      { onConflict: 'org_id,provider' },
    );
    if (upsertErr) return json({ error: 'Could not save provider settings.' }, 400, headers);
    return json({ ok: true }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
