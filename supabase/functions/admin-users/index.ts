import { createClient } from 'npm:@supabase/supabase-js@2';
import { decideAdminAction } from '../_shared/adminPolicy.ts';
import type { AdminAction, AdminContext, OrgRole } from '../_shared/adminPolicy.ts';

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
  const callerId = caller.id;

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  async function isPlatformOwner() {
    const { data, error } = await service.rpc('is_platform_owner', { p_user: callerId });
    return { isOwner: !error && data === true, error };
  }

  async function loadContext(orgId: string, targetUserId?: string): Promise<AdminContext | null> {
    const ownership = await isPlatformOwner();
    if (ownership.error) return null;
    const { data: membership, error: memberError } = await service.from('org_members')
      .select('role').eq('org_id', orgId).eq('user_id', callerId).maybeSingle();
    if (memberError) return null;
    let targetRole: OrgRole | null = null;
    let targetIsLastAdmin = false;
    if (targetUserId) {
      const { data: target, error: targetError } = await service.from('org_members')
        .select('role').eq('org_id', orgId).eq('user_id', targetUserId).maybeSingle();
      if (targetError) return null;
      targetRole = target?.role ?? null;
      if (targetRole === 'admin') {
        const { count, error: countError } = await service.from('org_members')
          .select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('role', 'admin');
        if (countError || count === null) return null;
        targetIsLastAdmin = count <= 1;
      }
    }
    return {
      callerIsOwner: ownership.isOwner, callerRole: membership?.role ?? null,
      isSelf: targetUserId === callerId, targetRole, newRole: null, targetIsLastAdmin,
    };
  }

  async function authorize(action: AdminAction, orgId = '', targetUserId?: string, newRole: OrgRole | null = null) {
    const ctx = await loadContext(orgId, targetUserId);
    if (!ctx) return json({ error: 'Could not check permissions' }, 500, headers);
    const decision = decideAdminAction(action, { ...ctx, newRole });
    return decision.ok ? null : json({ error: decision.error }, decision.status, headers);
  }

  const body = (await req.json()) as Record<string, unknown>;

  if (body.action === 'create_org') {
    const ownership = await isPlatformOwner();
    if (ownership.error) return json({ error: 'Could not check permissions' }, 500, headers);
    const decision = decideAdminAction('create_org', { callerIsOwner: ownership.isOwner, callerRole: null, isSelf: false, targetRole: null, newRole: null, targetIsLastAdmin: false });
    if (!decision.ok) return json({ error: decision.error }, decision.status, headers);
    const name = String(body.name ?? '').trim();
    if (!name) return json({ error: 'name is required' }, 400, headers);
    const { data, error } = await service.from('organizations').insert({ name, created_by: callerId }).select('id, name').single();
    if (error) return json({ error: error.message }, 400, headers);
    return json({ org: data }, 200, headers);
  }

  if (body.action === 'list_orgs') {
    const ownership = await isPlatformOwner();
    if (ownership.error) return json({ error: 'Could not check permissions' }, 500, headers);
    if (ownership.isOwner) {
      const { data, error } = await service.from('organizations').select('id, name').order('name');
      if (error) return json({ error: error.message }, 400, headers);
      const { data: memberships, error: memberError } = await service.from('org_members').select('role, organizations(id, name)').eq('user_id', callerId);
      if (memberError) return json({ error: 'Could not check permissions' }, 500, headers);
      const roles = new Map(((memberships as unknown as MembershipRow[]) ?? []).map((m) => [m.organizations.id, m.role]));
      return json({ orgs: (data ?? []).map((org) => ({ ...org, role: roles.get(org.id) ?? null })) }, 200, headers);
    }
    const { data, error } = await service
      .from('org_members').select('role, organizations(id, name)').eq('user_id', callerId);
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
    if (orgRole !== 'admin' && orgRole !== 'contractor' && orgRole !== 'team_member') return json({ error: 'Invalid org_role' }, 400, headers);
    if (!email) return json({ error: 'email is required' }, 400, headers);
    if (!APP_ORIGINS.some((o) => redirectTo.startsWith(o))) return json({ error: 'redirect_to not allowed' }, 400, headers);
    const denied = await authorize('invite', orgId, undefined, orgRole);
    if (denied) return denied;
    const { data: org } = await service.from('organizations').select('id').eq('id', orgId).maybeSingle();
    if (!org) return json({ error: 'Organization not found' }, 404, headers);

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
    if (role !== 'admin' && role !== 'contractor' && role !== 'team_member') return json({ error: 'Invalid role' }, 400, headers);
    if (userId === callerId) return json({ error: 'You cannot change your own role' }, 400, headers);
    const denied = await authorize('set_org_role', orgId, userId, role);
    if (denied) return denied;
    const { error } = await service.from('org_members').update({ role }).eq('org_id', orgId).eq('user_id', userId);
    if (error) return json({ error: error.message }, 400, headers);
    return json({ ok: true }, 200, headers);
  }

  if (body.action === 'remove_member') {
    const orgId = String(body.org_id ?? '');
    const userId = String(body.user_id ?? '');
    if (!orgId || !userId) return json({ error: 'org_id and user_id are required' }, 400, headers);
    if (userId === callerId) return json({ error: 'You cannot remove yourself' }, 400, headers);
    const denied = await authorize('remove_member', orgId, userId);
    if (denied) return denied;

    const { data: target } = await service.from('org_members').select('role').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
    if (!target) return json({ error: 'Not a member of this organization' }, 404, headers);

    // Their leads are unassigned, not deleted — historical notes/email logs keep
    // this person's attribution (those FKs point at profiles, not org_members).
    const { error: unassignErr } = await service.from('leads').update({ assigned_to: null }).eq('org_id', orgId).eq('assigned_to', userId);
    if (unassignErr) return json({ error: unassignErr.message }, 400, headers);

    const { error } = await service.from('org_members').delete().eq('org_id', orgId).eq('user_id', userId);
    if (error) return json({ error: error.message }, 400, headers);
    return json({ ok: true }, 200, headers);
  }

  if (body.action === 'list_org_members') {
    const orgId = String(body.org_id ?? '');
    if (!orgId) return json({ error: 'org_id is required' }, 400, headers);
    const denied = await authorize('list_org_members', orgId);
    if (denied) return denied;
    const { data, error } = await service
      .from('org_members').select('role, created_at, profiles(id, email, full_name, created_at)')
      .eq('org_id', orgId).order('created_at');
    if (error) return json({ error: error.message }, 400, headers);
    return json({ members: data }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
