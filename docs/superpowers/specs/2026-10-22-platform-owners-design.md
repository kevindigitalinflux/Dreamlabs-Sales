# Platform owners: who can create organisations and invite admins — Design

Date: 2026-10-22. Author: Claude (architect). Status: APPROVED by Kevin 2026-10-22 (build order 1 of 3). Plan not yet written. Not built.

## Kevin's decisions (kickoff, 2026-10-22)
- Admins of the **Mr Brush & Co** and **DI Dreamlabs** organisations are platform owners.
- Only platform owners can create organisations and invite organisation admins.
- An admin of any other organisation (UX Tree, Digital Influx Academy, future clients) manages their own team's normal members only. They cannot invite an admin or promote anyone to admin.

## What exists today (verified in code, 2026-10-22)
- `admin-users` (`supabase/functions/admin-users/index.ts`): `create_org` requires `profiles.platform_role = 'platform_admin'`. `invite`, `set_org_role`, `remove_member` and `list_org_members` use `canManageOrg` = platform admin OR admin of that org. So today a client-org admin can invite an admin and promote members to admin. This is the gap.
- `platform_role` is a column on `profiles` (migration 003), seeded `platform_admin` only for kevindigitalinflux@gmail.com. It is locked from client writes (migration 017: column-scoped UPDATE grant excludes it).
- The same flag is read in `supabase/functions/org-api-settings/index.ts:117-119` (platform admin counts as member and manager of every org) and in the UI at `src/pages/Admin.tsx:23` (shows New organisation, org picker, platform sections).
- Unchecked: who holds `platform_admin` in the live database right now. Step 1 of the build is a read-only query.

## Design
1. **Single source of truth, derived from membership.** Add `organizations.grants_platform_owner boolean not null default false`. Set it true for Mr Brush & Co and DI Dreamlabs only (by name match inside the migration, asserting exactly two rows updated). A user is a platform owner when they hold role `admin` in any org with that flag. Add `public.is_platform_owner(p_user uuid) returns boolean`, `SECURITY DEFINER`, `STABLE`, fixed `search_path`; `EXECUTE` revoked from `anon`, granted to `authenticated` and `service_role`.
2. **Replace the flag checks, keep the column.** `isPlatformAdmin()` in `admin-users`, the check in `org-api-settings`, and `Admin.tsx` all switch to the derived rule. Keep `profiles.platform_role` untouched and unused for authorization (no destructive change; removal is a later cleanup). Kevin stays an owner because he is admin of DI Dreamlabs. Verify that before deploying, or Kevin locks himself out.
3. **Who can do what** (enforced in `admin-users`, never UI-only):

| Action | Platform owner | Admin of a client org | Others |
|---|---|---|---|
| `create_org` | yes | no | no |
| `invite` role `admin` | yes (any org) | no | no |
| `invite` role `team_member` or `contractor` | yes (any org) | yes (own org) | no |
| `set_org_role` to or from `admin` | yes | no | no |
| `set_org_role` between non-admin roles | yes | yes (own org) | no |
| `remove_member` of an admin | yes | no | no |
| `remove_member` of a non-admin | yes | yes (own org) | no |
| `list_org_members`, `list_orgs` | all orgs | own org | no |

   Existing rules stay: no self role change, no self removal, cannot remove the last admin of an org.
4. **Protect the owner orgs.** A client-org admin has no power over Mr Brush or DI Dreamlabs. Inside the two flagged orgs, only platform owners manage admins (same table). Removing or demoting the last admin of a flagged org is refused (existing last-admin rule), so ownership cannot vanish by accident.
5. **UI.** `Admin.tsx`: New organisation button, org picker over all orgs, and the "Admin" choice in `InviteModal` and the role control in `UserTable` appear only for platform owners. Client-org admins see their own org's members, invite for non-admin roles, and a plain explanation ("Only Dreamlabs can add admins") where the admin option would be. The server rejects regardless.
6. **Migration** `066_platform_owner_orgs.sql` (065 is reserved for the readiness badge). Additive: column, function, two updates with a row-count assertion. Kevin applies it in the SQL editor. An audit script (`supabase/audits/…` in the same style as the existing audits) checks: flag set on exactly two orgs; function true for a DI Dreamlabs admin, false for a UX Tree admin; function not executable by `anon`; client cannot update `grants_platform_owner` (column grant excludes it; RLS on organizations unchanged).

## Risk (confirmed by Kevin 2026-10-22: he is admin of both Mr Brush & Co and DI Dreamlabs; both are owner level)
Mr Brush & Co is also a real client business. Whoever is admin of the Mr Brush & Co org in this app becomes a platform owner who can see and manage every organisation, including UX Tree and the Academy. Today Kevin is not even a member of Mr Brush & Co in this app. Ask: who are the admins of that org now, and should any Mr Brush staff ever be admin there? If staff may become admin, they should not get platform power; the alternative is flagging DI Dreamlabs only, with Mr Brush managed by its owners as an ordinary client. This spec follows Kevin's decision (both orgs) but this is the one thing worth a second look.

## Out of scope
Billing, per-org quota changes, removing `platform_role`, SSO, org deletion, transferring ownership flows.

## Tests and delivery
- Extract the permission table into a pure module (`supabase/functions/_shared/adminPolicy.ts`) with Vitest tests for every row above, including: client admin inviting admin → 403; client admin promoting to admin → 403; client admin removing an admin → 403; owner doing each → allowed; cross-org attempts → 403; last-admin protection; owner status gained and lost when an admin role is changed in a flagged org.
- Live check after deploy using a throwaway UX Tree admin (follow the raw-SQL throwaway-user notes in project memory), then delete it.
- Branch `codex/platform-owners` built by Codex; Claude reviews the diff and runs gates; deploy `admin-users` and `org-api-settings` only after the migration is applied and Kevin's ownership is verified; every merge, push, deploy and migration needs Kevin's yes.
