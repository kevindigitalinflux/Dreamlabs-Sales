-- Adds "team_member" as a third org_members.role option, alongside the
-- existing admin/contractor. Same permissions as contractor (assignable to
-- leads, appears everywhere a non-admin org member does) -- purely a label
-- distinction for in-house staff vs external contractors. No RLS policy
-- changes needed: every existing policy gates on role = 'admin', never on
-- role = 'contractor', so a third non-admin value needs no new policy.

ALTER TABLE org_members DROP CONSTRAINT org_members_role_check;
ALTER TABLE org_members ADD CONSTRAINT org_members_role_check
  CHECK (role IN ('admin', 'contractor', 'team_member'));
