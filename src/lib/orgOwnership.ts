import type { OrgMembership, Role } from '../types';

interface MembershipRow {
  role: Role;
  organizations: { id: string; name: string; custom_packages: string[] | null; grants_platform_owner?: boolean };
}

/** Ownership requires admin membership in a flagged organisation, independent of the selected org. */
export function isOwnerFromMemberships(memberships: readonly { role: string; grants_platform_owner?: boolean }[]): boolean {
  return memberships.some((m) => m.role === 'admin' && m.grants_platform_owner === true);
}

/** Retains normal org access if the additive owner column is not available yet. */
export async function loadOrgMemberships(
  read: (includeOwnerFlag: boolean) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<OrgMembership[]> {
  let result = await read(true);
  let ownerColumnAvailable = true;
  if (result.error) {
    ownerColumnAvailable = false;
    result = await read(false);
  }
  if (result.error) return [];
  return ((result.data as MembershipRow[] | null) ?? []).map((r) => ({
    id: r.organizations.id, name: r.organizations.name, role: r.role,
    custom_packages: r.organizations.custom_packages,
    grants_platform_owner: ownerColumnAvailable && r.organizations.grants_platform_owner === true,
  }));
}
