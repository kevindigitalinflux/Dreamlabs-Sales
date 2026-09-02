import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

type Provider = 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter';

async function validateKey(provider: Provider, key: string): Promise<string | null> {
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
  const canManage = membership?.role === 'admin' || profile?.platform_role === 'platform_admin';
  if (!canManage) return json({ error: 'Org admin only' }, 403, headers);

  if (body.action === 'get') {
    const { data, error } = await service.from('org_api_settings').select('provider, is_configured').eq('org_id', orgId);
    if (error) return json({ error: error.message }, 400, headers);
    return json({ settings: data }, 200, headers);
  }

  if (body.action === 'save') {
    const provider = String(body.provider ?? '') as Provider;
    const apiKey = String(body.api_key ?? '').trim();
    if (!['gemini', 'google_places', 'companies_house', 'apollo', 'hunter'].includes(provider)) return json({ error: 'Invalid provider' }, 400, headers);
    if (!apiKey) return json({ error: 'api_key is required' }, 400, headers);

    const validationError = await validateKey(provider, apiKey);
    if (validationError) return json({ error: validationError }, 400, headers);

    const { error: vaultErr } = await service.rpc('app_set_org_api_key', { target_org: orgId, target_provider: provider, secret: apiKey });
    if (vaultErr) return json({ error: 'Could not store the key: ' + vaultErr.message }, 500, headers);
    const { error: upsertErr } = await service.from('org_api_settings').upsert(
      { org_id: orgId, provider, is_configured: true, updated_at: new Date().toISOString() },
      { onConflict: 'org_id,provider' },
    );
    if (upsertErr) return json({ error: upsertErr.message }, 400, headers);
    return json({ ok: true }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
