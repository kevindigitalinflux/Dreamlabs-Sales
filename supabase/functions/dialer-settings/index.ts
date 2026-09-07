import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const VALID_PROVIDERS = ['justcall', 'kixie', 'aircall'];

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
  const user = userData?.user;
  if (!user) return json({ error: 'Not signed in' }, 401, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers);
  }

  if (body.action === 'get') {
    const { data } = await service
      .from('user_dialer_settings').select('*').eq('user_id', user.id).maybeSingle();
    return json({ settings: data }, 200, headers);
  }

  if (body.action === 'save') {
    const provider = String(body.provider ?? '');
    if (!VALID_PROVIDERS.includes(provider)) {
      return json({ error: 'provider must be one of justcall, kixie, aircall' }, 400, headers);
    }
    const phoneNumber = body.phone_number ? String(body.phone_number) : null;
    const apiKey = body.api_key ? String(body.api_key) : null;

    const { error: upsertErr } = await service.from('user_dialer_settings').upsert(
      { user_id: user.id, provider, phone_number: phoneNumber, is_verified: false, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    if (upsertErr) return json({ error: upsertErr.message }, 400, headers);

    if (apiKey) {
      const { error: vaultErr } = await service.rpc('app_set_dialer_secret', { uid: user.id, secret: apiKey });
      if (vaultErr) return json({ error: 'Could not store API key: ' + vaultErr.message }, 500, headers);
    }
    return json({ ok: true }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
