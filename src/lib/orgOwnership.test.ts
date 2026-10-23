import { expect, it, vi } from 'vitest';
import { isOwnerFromMemberships, loadOrgMemberships } from './orgOwnership';

it('requires admin membership and a true flag on the same organisation', () => {
  expect(isOwnerFromMemberships([])).toBe(false);
  expect(isOwnerFromMemberships([{ role: 'admin' }])).toBe(false);
  expect(isOwnerFromMemberships([{ role: 'admin', grants_platform_owner: false }, { role: 'contractor', grants_platform_owner: true }])).toBe(false);
  expect(isOwnerFromMemberships([{ role: 'admin', grants_platform_owner: true }])).toBe(true);
});
it('ownership follows membership promotion and demotion', () => {
  const membership = { role: 'team_member', grants_platform_owner: true };
  expect(isOwnerFromMemberships([membership])).toBe(false);
  membership.role = 'admin';
  expect(isOwnerFromMemberships([membership])).toBe(true);
  membership.role = 'contractor';
  expect(isOwnerFromMemberships([membership])).toBe(false);
});
it('preserves normal memberships with ownership false when column lookup fails', async () => {
  const read = vi.fn().mockResolvedValueOnce({ data: null, error: { code: '42703' } }).mockResolvedValueOnce({
    data: [{ role: 'admin', organizations: { id: 'org', name: 'Org', custom_packages: null } }], error: null,
  });
  const memberships = await loadOrgMemberships(read);
  expect(read.mock.calls).toEqual([[true], [false]]);
  expect(memberships).toEqual([{ id: 'org', name: 'Org', custom_packages: null, role: 'admin', grants_platform_owner: false }]);
  expect(isOwnerFromMemberships(memberships)).toBe(false);
});
it('maps the owner column only when strictly true', async () => {
  const read = vi.fn().mockResolvedValue({ data: [
    { role: 'admin', organizations: { id: 'org', name: 'Org', custom_packages: null, grants_platform_owner: true } },
  ], error: null });
  expect(isOwnerFromMemberships(await loadOrgMemberships(read))).toBe(true);
  expect(read).toHaveBeenCalledOnce();
});
it('returns no ownership when both reads fail', async () => {
  const read = vi.fn().mockResolvedValue({ data: null, error: { code: 'failed' } });
  expect(await loadOrgMemberships(read)).toEqual([]);
});
