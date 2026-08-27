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

interface MembershipRow { role: string; organizations: { id: string; name: string } }

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

  async function isPlatformAdmin(): Promise<boolean> {
    const { data } = await service.from('profiles').select('platform_role').eq('id', caller.id).single();
    return data?.platform_role === 'platform_admin';
  }
  async function isOrgAdmin(orgId: string): Promise<boolean> {
    const { data } = await service.from('org_members').select('role').eq('org_id', orgId).eq('user_id', caller.id).maybeSingle();
    return data?.role === 'admin';
  }
  async function canManageOrg(orgId: string): Promise<boolean> {
    return (await isPlatformAdmin()) || (await isOrgAdmin(orgId));
  }

  const body = (await req.json()) as Record<string, unknown>;

  if (body.action === 'create_org') {
    if (!(await isPlatformAdmin())) return json({ error: 'Platform admin only' }, 403, headers);
    const name = String(body.name ?? '').trim();
    if (!name) return json({ error: 'name is required' }, 400, headers);
    const { data, error } = await service.from('organizations').insert({ name, created_by: caller.id }).select('id, name').single();
    if (error) return json({ error: error.message }, 400, headers);
    return json({ org: data }, 200, headers);
  }

  if (body.action === 'list_orgs') {
    if (await isPlatformAdmin()) {
      const { data, error } = await service.from('organizations').select('id, name').order('name');
      if (error) return json({ error: error.message }, 400, headers);
      return json({ orgs: data }, 200, headers);
    }
    const { data, error } = await service
      .from('org_members').select('role, organizations(id, name)').eq('user_id', caller.id);
    if (error) return json({ error: error.message }, 400, headers);
    const rows = (data as unknown as MembershipRow[]) ?? [];
    const orgs = rows.map((r) => ({ id: r.organizations.id, name: r.organizations.name, role: r.role }));
    return json({ orgs }, 200, headers);
  }

  if (body.action === 'invite') {
    const orgId = String(body.org_id ?? '');
    const orgRole = String(body.org_role ?? 'contractor');
    const email = String(body.email ?? '');
    const fullName = String(body.full_name ?? '');
    const redirectTo = String(body.redirect_to ?? '');
    if (!orgId) return json({ error: 'org_id is required' }, 400, headers);
    if (orgRole !== 'admin' && orgRole !== 'contractor') return json({ error: 'Invalid org_role' }, 400, headers);
    if (!email) return json({ error: 'email is required' }, 400, headers);
    if (!APP_ORIGINS.some((o) => redirectTo.startsWith(o))) return json({ error: 'redirect_to not allowed' }, 400, headers);
    if (!(await canManageOrg(orgId))) return json({ error: 'Admin only' }, 403, headers);

    const { data: invited, error } = await service.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo,
    });
    if (error) return json({ error: error.message }, 400, headers);
    const { error: memberErr } = await service.from('org_members').insert({
      org_id: orgId, user_id: invited.user.id, role: orgRole,
    });
    if (memberErr) return json({ error: memberErr.message }, 400, headers);
    return json({ ok: true }, 200, headers);
  }

  if (body.action === 'set_org_role') {
    const orgId = String(body.org_id ?? '');
    const userId = String(body.user_id ?? '');
    const role = String(body.role ?? '');
    if (role !== 'admin' && role !== 'contractor') return json({ error: 'Invalid role' }, 400, headers);
    if (userId === caller.id) return json({ error: 'You cannot change your own role' }, 400, headers);
    if (!(await canManageOrg(orgId))) return json({ error: 'Admin only' }, 403, headers);
    const { error } = await service.from('org_members').update({ role }).eq('org_id', orgId).eq('user_id', userId);
    if (error) return json({ error: error.message }, 400, headers);
    return json({ ok: true }, 200, headers);
  }

  if (body.action === 'list_org_members') {
    const orgId = String(body.org_id ?? '');
    if (!orgId) return json({ error: 'org_id is required' }, 400, headers);
    if (!(await canManageOrg(orgId))) return json({ error: 'Admin only' }, 403, headers);
    const { data, error } = await service
      .from('org_members').select('role, created_at, profiles(id, email, full_name, created_at)')
      .eq('org_id', orgId).order('created_at');
    if (error) return json({ error: error.message }, 400, headers);
    return json({ members: data }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
