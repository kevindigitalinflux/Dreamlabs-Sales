# Platform Owners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax.

**Goal:** Admins of the Mr Brush & Co and DI Dreamlabs organisations are platform owners. Only owners can create organisations and invite, promote, demote or remove organisation admins. An admin of any other organisation manages only that organisation's non-admin members.

**Architecture:** One database flag (`organizations.grants_platform_owner`) plus a service-role-only SQL function `is_platform_owner(uuid)` define ownership (derived from membership; `profiles.platform_role` stays in the table but is no longer read). A pure, import-free rules module `supabase/functions/_shared/adminPolicy.ts` holds the permission table and is unit-tested. `admin-users` and `org-api-settings` call it. The UI hides what the server would refuse, and the server refuses regardless.

**Tech Stack:** Supabase Postgres + RLS, Deno edge functions, React 19, TypeScript strict, vitest (node, `.ts` tests importing from `supabase/functions/_shared`).

**Spec:** `docs/superpowers/specs/2026-10-22-platform-owners-design.md` (approved by Kevin 2026-10-22). Read it first.

## Global Constraints

- Roles: Codex builds on branch `codex/platform-owners` from clean `main`; Claude reviews; Kevin applies the migration and approves every merge, push and deploy. No role change.
- **Order of rollout matters:** (1) apply migration 066, (2) deploy `admin-users` and `org-api-settings`, (3) deploy the front end. The front end selects the new column, so shipping it before the migration breaks login for everyone (same trap as migration 037).
- **Kevin must not lose access.** Before step 2, verify (read-only) that the account kevindigitalinflux@gmail.com is `admin` in the organisation named `DI Dreamlabs`. If not, stop and tell Kevin.
- Ownership = holds role `admin` in an organisation with `grants_platform_owner = true`. Exactly two organisations get the flag: `Mr Brush & Co` and `DI Dreamlabs` (names as they are now in the database; the migration matches both and raises if it does not update exactly two rows).
- Never trust the browser. Every rule is enforced in `admin-users`. Fail closed: if the ownership lookup errors, treat the caller as not an owner and return 500 for owner-only actions.
- `profiles.platform_role` is not read anywhere after this plan. Do not drop or edit the column or its grants (migration 017 locks it).
- Keep existing behaviour that is not in the table below: no self role change, no self removal, cannot remove the last admin of an organisation. NEW: cannot demote the last admin either.
- Errors never print member emails or secrets. Plain, fixed sentences.
- TypeScript strict, named exports, no `any`. Run `npx tsc --noEmit`, `npx vitest run`, `npm run build` before reporting done. Stage explicit paths only (CRLF noise exists in this checkout). Commit hooks may be skipped; Claude refreshes the vault mirror.

## Permission table (single source of truth)

| Action | Platform owner | Admin of that org, not an owner | Anyone else |
|---|---|---|---|
| `create_org` | allow | deny | deny |
| `invite` with role `admin` | allow (any org) | deny | deny |
| `invite` with role `team_member` or `contractor` | allow (any org) | allow (own org) | deny |
| `set_org_role` where the target is currently `admin` or the new role is `admin` | allow | deny | deny |
| `set_org_role` between `team_member` and `contractor` | allow | allow (own org) | deny |
| `remove_member` of a current `admin` | allow | deny | deny |
| `remove_member` of a non-admin | allow | allow (own org) | deny |
| `list_org_members` | allow (any org) | allow (own org) | deny |
| `list_orgs` | all orgs | own orgs | own orgs |

Server messages (fixed): `Platform owners only` (create_org), `Only platform owners can add or change admins`, `Admin only`, `You cannot change your own role`, `You cannot remove yourself`, `Cannot remove or demote the last admin of an organization`.

## File Structure

- Create `supabase/migrations/066_platform_owner_orgs.sql` and `supabase/audits/platform_owner_orgs.sql`.
- Create `supabase/functions/_shared/adminPolicy.ts` (pure) and `src/lib/adminPolicy.test.ts`.
- Modify `supabase/functions/admin-users/index.ts` and `supabase/functions/org-api-settings/index.ts`.
- Modify `src/hooks/useOrg.tsx`, `src/types/index.ts` (membership gains `grants_platform_owner`), `src/pages/Admin.tsx`, `src/components/admin/InviteModal.tsx`, `src/components/admin/UserTable.tsx`.
- Docs: `docs/HANDOFF.md`, `docs/NEXT-STEPS.md`, `docs/AUTOMATIONS.md` (admin actions), `CLAUDE.md` status line.

---

### Task 1: Migration 066 and audit script (written, not applied)

**Files:** `supabase/migrations/066_platform_owner_orgs.sql`, `supabase/audits/platform_owner_orgs.sql`.

- [x] **Step 1: Write the migration.** Additive and idempotent where possible:
  - `ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS grants_platform_owner boolean NOT NULL DEFAULT false;`
  - In one `DO` block: `UPDATE public.organizations SET grants_platform_owner = true WHERE name IN ('Mr Brush & Co', 'DI Dreamlabs');` then `GET DIAGNOSTICS n = ROW_COUNT;` and `IF n <> 2 THEN RAISE EXCEPTION 'expected exactly two owner organisations, updated %', n; END IF;` (the whole migration rolls back on mismatch). Re-running must not fail: use `WHERE ... AND NOT grants_platform_owner` only if you also count already-flagged rows; simplest is to count the flagged rows after the update (`SELECT count(*) ... WHERE grants_platform_owner`) and require exactly 2.
  - `CREATE OR REPLACE FUNCTION public.is_platform_owner(p_user uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$ SELECT EXISTS (SELECT 1 FROM org_members m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = p_user AND m.role = 'admin' AND o.grants_platform_owner) $$;`
  - `REVOKE ALL ON FUNCTION public.is_platform_owner(uuid) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.is_platform_owner(uuid) TO service_role;` (an arbitrary-user lookup must not be callable by clients).
  - Confirm no client can write the new column: `authenticated` must hold no table-wide UPDATE on `organizations` (migration 025 revoked it and granted only `company_context`). Do not add any grant. Add a comment on the column describing the rule.
- [x] **Step 2: Write the audit** `supabase/audits/platform_owner_orgs.sql` in the style of `lead_country_dismissed.sql` (one `DO` block, everything rolls back, ends with the mandatory final exception, prints no customer values). Assertions: column exists and defaults false; exactly two flagged organisations and their names are the two expected; RLS on `organizations` and `org_members` still enabled; `is_platform_owner` true for a real admin of a flagged org (use any existing admin row, do not print ids); false for an admin of an unflagged org (create two throwaway orgs and members inside the transaction, same technique as the other audits); false for a plain member of a flagged org (role not admin); false for an unknown uuid; `has_function_privilege('anon'|'authenticated', 'public.is_platform_owner(uuid)', 'EXECUTE')` is false and `service_role` true; `has_column_privilege('authenticated', 'public.organizations', 'grants_platform_owner', 'UPDATE')` is false; a simulated authenticated session (`SET LOCAL ROLE authenticated` plus `request.jwt.claims`) cannot UPDATE the column on its own org (expect `insufficient_privilege`).
- [x] **Step 3: Commit** (`feat: migration 066 and audit for platform owner organisations`). Do NOT run either file. Kevin applies 066 in the SQL editor after Claude's review, then runs the audit.

### Task 2: Permission rules module (tests first)

**Files:** `supabase/functions/_shared/adminPolicy.ts`, `src/lib/adminPolicy.test.ts`. Import-free module (no Deno or Node APIs).

- [x] **Step 1: Write failing tests** covering every row of the table, each as a named case. Contract to implement:

```ts
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
export function decideAdminAction(action: AdminAction, ctx: AdminContext): AdminDecision;
```

  Required cases: owner creates org (allow); non-owner admin creates org (deny `Platform owners only`); member creates org (deny). Invite: owner invites admin into any org (allow); non-owner org admin invites admin (deny `Only platform owners can add or change admins`); same admin invites contractor and team_member (allow); non-member invites anyone (deny `Admin only`). set_org_role: self (400 `You cannot change your own role`, checked first, even for owners); owner promotes contractor to admin and demotes admin to contractor (allow, unless the target is the last admin: deny 400 `Cannot remove or demote the last admin of an organization`); non-owner admin promotes to admin (deny), demotes an admin (deny), switches contractor to team_member (allow). remove_member: self (400 `You cannot remove yourself`); owner removes admin (allow, last admin: deny 400); non-owner admin removes admin (deny), removes contractor (allow); non-member (deny). list_org_members: owner (allow), org admin (allow), plain member and non-member (deny `Admin only`). Add a test that a non-owner caller whose `callerRole` is `admin` but who is acting on an org they do not belong to is represented as `callerRole: null` and denied.
- [x] **Step 2: Implement** `decideAdminAction` to satisfy the tests; one small function per action, shared `denyAdminOnly`/`denyOwnersOnly` constants for the fixed messages.
- [x] **Step 3: Run** `npx vitest run src/lib/adminPolicy.test.ts`, then the full suite. Commit.

### Task 3: `admin-users` uses the rules

**Files:** `supabase/functions/admin-users/index.ts`.

- [x] **Step 1:** Replace `isPlatformAdmin()` with `isPlatformOwner()` that calls `service.rpc('is_platform_owner', { p_user: caller.id })` and returns `true` only when the result is exactly `true`; on an RPC error return `{ error }` so owner-only actions answer 500 with `Could not check permissions` (fail closed). Remove `canManageOrg`/`isOrgAdmin` uses in favour of a helper `loadContext(orgId, targetUserId?)` that reads, with the service client: caller's role in `orgId` (or null), the target's current role, and whether the target is the last admin (count of admins in the org, only needed when the target is an admin).
- [x] **Step 2:** For each action build the `AdminContext` and call `decideAdminAction` BEFORE any write; return its status and error text verbatim. Keep the existing input validation (invalid role, missing email, `redirect_to` allow-list) and its order. `create_org` keeps its insert. After a successful `create_org`, nothing else changes.
- [x] **Step 3:** `list_orgs`: owners get all organisations (as today), everyone else gets their memberships (as today). Add each organisation's `role` for the caller where known so the UI can show it; do not expose `grants_platform_owner` to non-owners beyond what `useOrg` already reads.
- [x] **Step 4:** Add the demotion last-admin check to `set_org_role` through the shared context (new behaviour, decided in the spec). Keep `remove_member`'s unassign-leads behaviour and last-admin message unchanged except for the shared fixed sentence.
- [x] **Step 5:** Local checks only: `npx tsc --noEmit` and the edge TypeScript shim check used in earlier plans; Deno is not installed, so say that plainly in the report. Commit. Do not deploy.

### Task 4: `org-api-settings` uses ownership

**Files:** `supabase/functions/org-api-settings/index.ts`.

- [x] **Step 1:** Replace the `profiles.platform_role` read at lines ~117-119 with the same `is_platform_owner` RPC (shared tiny helper in `_shared/` if both functions use it, otherwise inline). `isMember = !!membership || isOwner`; `canManage = membership?.role === 'admin' || isOwner`. Behaviour for everyone else is unchanged. Fail closed on an RPC error (treat as not an owner).
- [x] **Step 2:** Confirm by grep that no other edge function, SQL function, RLS policy or front-end file reads `platform_role` after Tasks 3-5 (only the column definition, the type and migration history remain). Commit.

### Task 5: Front end

**Files:** `src/types/index.ts`, `src/hooks/useOrg.tsx`, `src/pages/Admin.tsx`, `src/components/admin/InviteModal.tsx`, `src/components/admin/UserTable.tsx`.

- [x] **Step 1:** `OrgMembership` gains `grants_platform_owner: boolean`; `useOrg` selects `organizations(id, name, custom_packages, grants_platform_owner)` and exposes `isPlatformOwner` = some membership has `role === 'admin'` and `grants_platform_owner`. Provide a pure helper `isOwnerFromMemberships(memberships)` in `src/lib/` with a test. A failed or missing column must not crash login: treat missing as `false`.
- [x] **Step 2:** `Admin.tsx`: replace `profile?.platform_role === 'platform_admin'` with `isPlatformOwner`. New organization button and the org picker show only for owners. The Invite button stays for any org admin.
- [x] **Step 3:** `InviteModal` gets `canInviteAdmin: boolean`; the Admin option is shown only when true. When false, show one muted line "Only Dreamlabs platform owners can add admins." under the role field. Default role stays Contractor.
- [x] **Step 4:** `UserTable` gets `isOwner: boolean`: for non-owners, the role control is disabled on rows whose role is `admin`, the Admin option is hidden in other rows, and Remove is disabled for admin rows with a `title` explaining why. The server still enforces. Keep existing self-protection.
- [x] **Step 5:** Accessibility and responsive checks (project rule): keyboard reachable, disabled controls explain themselves in text not colour alone, nothing overflows at 400 px. Run `npx tsc --noEmit`, `npx vitest run`, `npm run build`. Commit.

### Task 6: Documentation and handoff

- [x] Update `docs/HANDOFF.md` (new section with branch, commits, gates, files, rollout order, unverified items), `docs/NEXT-STEPS.md` section 0, `docs/AUTOMATIONS.md` (the `admin-users` rules table), and a short `CLAUDE.md` Current Status entry. State what is NOT verified: Deno runtime, live migration, live audit, browser checks, deployment. No vault write by the builder; Claude syncs.

## Review and rollout (Claude and Kevin, after the builder reports)

1. Claude reviews the exact commit against the spec and the permission table (including that nothing but `admin-users`/`org-api-settings` read ownership, and that `is_platform_owner` is not executable by clients).
2. Kevin applies `066_platform_owner_orgs.sql` in the SQL editor and runs `supabase/audits/platform_owner_orgs.sql` (all PASS, rolled back).
3. Claude runs the read-only check that `kevindigitalinflux@gmail.com` is admin in `DI Dreamlabs`, then, with Kevin's yes, deploys `admin-users` and `org-api-settings`.
4. Live check with a throwaway UX Tree admin (create via the raw-SQL pattern in project memory; delete afterwards): invite admin to UX Tree is 403; invite contractor is 200; promote to admin is 403; create org is 403; Kevin's own account still creates orgs and invites admins. Remove all throwaway rows and confirm counts.
5. With Kevin's yes, merge and push (Cloudflare auto-deploys), then check the live bundle for the new Admin strings and look at `/admin` as an owner and as a non-owner admin.
6. Rollback if anything misbehaves: redeploy the previous `admin-users` and `org-api-settings` from `main` before the merge; migration 066 is additive and can stay. Frontend rollback is a revert commit.

## Self-review notes

- The spec's "last admin of a flagged org cannot be demoted" is covered by the general last-admin rule in Task 3, not a special case.
- A non-owner can never be admin of a flagged organisation, by definition, so no separate rule protects the two owner organisations.
- Known follow-ups, not in scope: dropping `platform_role`, an audit log for admin actions (security audit WARNING), transferring ownership flows.

## Builder completion notes (2026-10-22)
Tasks 1–6 are locally implemented. Checkmarks record written code/documentation and local checks, not migration/audit execution, browser verification, independent architect review or publication. Those remain pending under Kevin’s explicit no-remote-work instruction. The initial checkout was clean main; Codex created the requested branch. Added handler and rendered-control regressions, plus a tested legacy membership-query fallback. See HANDOFF "Platform owners — local build" for evidence, service-only-grant rationale and unresolved architect review items.
