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

  const authHeader = req.headers.get('Authorization') ?? '';
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await anonClient.auth.getUser();
  const caller = userData?.user;
  if (!caller) return json({ error: 'Not signed in' }, 401, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = (await req.json()) as Record<string, unknown>;
  if (body.action !== 'share_cross_org') return json({ error: 'Unknown action' }, 400, headers);

  const pipelineId = String(body.pipeline_id ?? '');
  const email = String(body.email ?? '').trim().toLowerCase();
  const permission = String(body.permission ?? '');
  if (!pipelineId) return json({ error: 'pipeline_id is required' }, 400, headers);
  if (!email) return json({ error: 'email is required' }, 400, headers);
  if (permission !== 'view' && permission !== 'edit') return json({ error: 'Invalid permission' }, 400, headers);

  const { data: pipeline } = await service.from('pipelines').select('id, org_id, is_default').eq('id', pipelineId).maybeSingle();
  if (!pipeline) return json({ error: 'Pipeline not found' }, 404, headers);
  if (pipeline.is_default) return json({ error: 'The default pipeline cannot be shared outside the org' }, 400, headers);

  const { data: callerMembership } = await service
    .from('org_members').select('role').eq('org_id', pipeline.org_id).eq('user_id', caller.id).maybeSingle();
  const callerIsAdmin = callerMembership?.role === 'admin';
  if (!callerIsAdmin) {
    return json({ error: 'Cross-org sharing requires an org admin' }, 403, headers);
  }

  const { data: targetProfile } = await service.from('profiles').select('id').eq('email', email).maybeSingle();
  // Deliberately generic — never confirms whether a non-admin email exists at all.
  const notFoundError = { error: 'No matching admin found for that email' };
  if (!targetProfile) return json(notFoundError, 404, headers);

  const { data: targetIsAdminAnywhere } = await service
    .from('org_members').select('org_id').eq('user_id', targetProfile.id).eq('role', 'admin').limit(1);
  if (!targetIsAdminAnywhere || targetIsAdminAnywhere.length === 0) return json(notFoundError, 404, headers);

  const { error: shareErr } = await service.from('pipeline_shares').insert({
    pipeline_id: pipelineId, shared_with_user_id: targetProfile.id, permission, shared_by: caller.id,
  });
  if (shareErr) return json({ error: shareErr.message }, 400, headers);
  return json({ ok: true }, 200, headers);
});
