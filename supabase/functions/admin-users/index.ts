import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? 'http://localhost:5173').split(',');

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && APP_ORIGINS.includes(origin) ? origin : APP_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  // 1. Identify the caller from their JWT.
  const authHeader = req.headers.get('Authorization') ?? '';
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await anonClient.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401, headers);

  // 2. Verify the caller is an admin (service client bypasses RLS for this check).
  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: caller } = await service
    .from('profiles').select('role').eq('id', userData.user.id).single();
  if (caller?.role !== 'admin') return json({ error: 'Admin only' }, 403, headers);

  // 3. Perform the action.
  const body = (await req.json()) as Record<string, unknown>;

  if (body.action === 'invite') {
    const email = String(body.email ?? '');
    const fullName = String(body.full_name ?? '');
    const redirectTo = String(body.redirect_to ?? '');
    if (!email) return json({ error: 'email is required' }, 400, headers);
    if (!APP_ORIGINS.some((o) => redirectTo.startsWith(o))) {
      return json({ error: 'redirect_to not allowed' }, 400, headers);
    }
    const { error } = await service.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo,
    });
    if (error) return json({ error: error.message }, 400, headers);
    return json({ ok: true }, 200, headers);
  }

  if (body.action === 'set_role') {
    const userId = String(body.user_id ?? '');
    const role = String(body.role ?? '');
    if (role !== 'admin' && role !== 'contractor') return json({ error: 'Invalid role' }, 400, headers);
    if (userId === userData.user.id) return json({ error: 'You cannot change your own role' }, 400, headers);
    const { error } = await service.from('profiles').update({ role }).eq('id', userId);
    if (error) return json({ error: error.message }, 400, headers);
    return json({ ok: true }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
