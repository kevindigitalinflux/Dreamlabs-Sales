export type OrgRole = 'admin' | 'contractor' | 'team_member';
export type AdminAction = 'create_org' | 'invite' | 'set_org_role' | 'remove_member' | 'list_org_members';
export interface AdminContext {
  callerIsOwner: boolean;
  /** Caller's role in the TARGET organisation, or null if not a member. */
  callerRole: OrgRole | null;
  isSelf: boolean;
  /** Current role of the member being changed or removed, or null if none. */
  targetRole: OrgRole | null;
  /** Role being granted (invite or set_org_role). */
  newRole: OrgRole | null;
  /** True when the target is the only admin of the organisation. */
  targetIsLastAdmin: boolean;
}
export type AdminDecision = { ok: true } | { ok: false; status: 400 | 403; error: string };
const allow: AdminDecision = { ok: true };
const denyAdminOnly: AdminDecision = { ok: false, status: 403, error: 'Admin only' };
const denyOwnersOnly: AdminDecision = { ok: false, status: 403, error: 'Only platform owners can add or change admins' };
const denyLastAdmin: AdminDecision = { ok: false, status: 400, error: 'Cannot remove or demote the last admin of an organization' };

function canManage(ctx: AdminContext): boolean {
  return ctx.callerIsOwner || ctx.callerRole === 'admin';
}
function invite(ctx: AdminContext): AdminDecision {
  if (!canManage(ctx)) return denyAdminOnly;
  return ctx.newRole === 'admin' && !ctx.callerIsOwner ? denyOwnersOnly : allow;
}
function setRole(ctx: AdminContext): AdminDecision {
  if (ctx.isSelf) return { ok: false, status: 400, error: 'You cannot change your own role' };
  if (!canManage(ctx)) return denyAdminOnly;
  if ((ctx.targetRole === 'admin' || ctx.newRole === 'admin') && !ctx.callerIsOwner) return denyOwnersOnly;
  if (ctx.targetRole === 'admin' && ctx.targetIsLastAdmin && ctx.newRole !== 'admin') return denyLastAdmin;
  return allow;
}
function remove(ctx: AdminContext): AdminDecision {
  if (ctx.isSelf) return { ok: false, status: 400, error: 'You cannot remove yourself' };
  if (!canManage(ctx)) return denyAdminOnly;
  if (ctx.targetRole === 'admin' && !ctx.callerIsOwner) return denyOwnersOnly;
  if (ctx.targetRole === 'admin' && ctx.targetIsLastAdmin) return denyLastAdmin;
  return allow;
}

/** Enforces org-scoped administration, with self and last-admin protection. */
export function decideAdminAction(action: AdminAction, ctx: AdminContext): AdminDecision {
  switch (action) {
    case 'create_org': return ctx.callerIsOwner ? allow : { ok: false, status: 403, error: 'Platform owners only' };
    case 'invite': return invite(ctx);
    case 'set_org_role': return setRole(ctx);
    case 'remove_member': return remove(ctx);
    case 'list_org_members': return canManage(ctx) ? allow : denyAdminOnly;
  }
}
