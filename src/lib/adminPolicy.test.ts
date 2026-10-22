import { describe, expect, it } from 'vitest';
import { decideAdminAction } from '../../supabase/functions/_shared/adminPolicy';
import type { AdminAction, AdminContext, OrgRole } from '../../supabase/functions/_shared/adminPolicy';

const base: AdminContext = {
  callerIsOwner: false, callerRole: null, isSelf: false,
  targetRole: null, newRole: null, targetIsLastAdmin: false,
};
const ownersOnly = 'Only platform owners can add or change admins';
const lastAdmin = 'Cannot remove or demote the last admin of an organization';

describe('admin permission table', () => {
  const actors = [
    { name: 'owner across orgs', callerIsOwner: true, callerRole: null },
    { name: 'own org admin', callerIsOwner: false, callerRole: 'admin' },
    { name: 'plain member', callerIsOwner: false, callerRole: 'team_member' },
    { name: 'contractor', callerIsOwner: false, callerRole: 'contractor' },
    { name: 'other org admin represented as non-member', callerIsOwner: false, callerRole: null },
  ] as const;
  for (const actor of actors) {
    const manages = actor.callerIsOwner || actor.callerRole === 'admin';
    const check = (name: string, action: AdminAction, patch: Partial<AdminContext>, allowed: boolean, error = 'Admin only') => {
      it(`${actor.name}: ${name}`, () => {
        expect(decideAdminAction(action, { ...base, ...actor, ...patch })).toEqual(
          allowed ? { ok: true } : { ok: false, status: 403, error },
        );
      });
    };
    check('creates org', 'create_org', {}, actor.callerIsOwner, 'Platform owners only');
    check('lists members', 'list_org_members', {}, manages);
    for (const newRole of ['admin', 'contractor', 'team_member'] as OrgRole[]) {
      check(`invites ${newRole}`, 'invite', { newRole }, manages && (newRole !== 'admin' || actor.callerIsOwner),
        manages ? ownersOnly : 'Admin only');
      for (const targetRole of ['admin', 'contractor', 'team_member'] as OrgRole[]) {
        const adminChange = newRole === 'admin' || targetRole === 'admin';
        check(`changes ${targetRole} to ${newRole}`, 'set_org_role', { targetRole, newRole },
          manages && (!adminChange || actor.callerIsOwner), manages ? ownersOnly : 'Admin only');
      }
    }
    for (const targetRole of ['admin', 'contractor', 'team_member'] as OrgRole[]) {
      check(`removes ${targetRole}`, 'remove_member', { targetRole }, manages && (targetRole !== 'admin' || actor.callerIsOwner),
        manages ? ownersOnly : 'Admin only');
    }
    for (const [action, error] of [['set_org_role', 'You cannot change your own role'], ['remove_member', 'You cannot remove yourself']] as const) {
      it(`${actor.name}: ${action} rejects self first`, () => {
        expect(decideAdminAction(action, { ...base, ...actor, isSelf: true, targetIsLastAdmin: true, targetRole: 'admin', newRole: 'contractor' }))
          .toEqual({ ok: false, status: 400, error });
      });
    }
  }
  for (const action of ['set_org_role', 'remove_member'] as const) {
    it(`owner cannot ${action} last admin`, () => {
      expect(decideAdminAction(action, { ...base, callerIsOwner: true, targetRole: 'admin', newRole: 'contractor', targetIsLastAdmin: true }))
        .toEqual({ ok: false, status: 400, error: lastAdmin });
    });
  }
  it('owner may keep last admin as admin', () => {
    expect(decideAdminAction('set_org_role', { ...base, callerIsOwner: true, targetRole: 'admin', newRole: 'admin', targetIsLastAdmin: true }))
      .toEqual({ ok: true });
  });
});
