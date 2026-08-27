# Cycle 3 — Multi-Tenant Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-tenant Dreamlabs Sales CRM into a multi-tenant app — organizations, membership, org-scoped RLS across every table, org-level BYO API keys, Google Sign-In, and an org-aware admin panel — without breaking the live app Kevin uses today.

**Architecture:** Two-phase migration against a **live production database**. Phase A (Tasks 1–7) is purely additive — new tables, nullable columns, new edge-function actions, new client code — the existing app keeps working completely unchanged throughout. Phase B (Tasks 8–11) is the cutover: RLS policies rewritten from the old global `is_admin()` to org-scoped checks, `org_id` columns set `NOT NULL`, every client `.role` check migrated to the new org-scoped role, and only at the very end is the old `profiles.role` column and `is_admin()` function dropped. Task 12 is the full audit + docs.

**Tech Stack:** Same as cycles 1–2 — React 19 + Vite + TS strict + Tailwind v4 + Supabase (Postgres/RLS/Vault/Edge Functions, Deno runtime).

## Global Constraints

- TypeScript strict; no `any` (cast via `unknown`); named exports only; Tailwind utilities only; every component handles loading/error/empty; components < 150 lines; JSDoc on exported functions.
- Existing UI primitives (import, don't recreate): `Button`, `Input/Textarea/SelectField`, `Modal`, `Card`, `Skeleton`, `EmptyState`, `MultiSelect`.
- **This migration runs against a live database with real data.** Every Phase-A task must leave the app in a fully working state when its commit lands — verify the existing app still works, not just that the new code compiles. Never combine an RLS-breaking change with an unfinished client update in the same task.
- Commits: `feat:`/`fix:`/`chore:` style, one per task, push after each (except migration-apply steps, which follow the same commit-then-apply pattern as cycles 1–2).
- Working dir: `C:\Users\kevin\Projects\dreamlabs-sales`. Commands below are POSIX (Git Bash).
- Verify commands: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
- Management-API SQL runner (bypasses RLS; for applying migrations and verification):
  `curl -s -X POST "https://api.supabase.com/v1/projects/wgomksxelyfkzepbnkdd/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d @query.json`
  (`SUPABASE_ACCESS_TOKEN` is in the project's gitignored `.env`; write the JSON `{"query":"..."}` to a file first — never pass raw SQL through shell quoting.)
- Edge function deploys: `npx supabase functions deploy <name>`. Function secrets: `npx supabase secrets set NAME=value`.
- Browser verification: dev server on `http://localhost:5173`, Kevin's session usually signed in as `kevindigitalinflux@gmail.com`. DB ground truth via the management-API runner.
- Kevin's real, currently-used data lives in this database (real leads, templates, logs). Treat every migration step as production-sensitive — verify before and after, never assume.

---

### Task 1: Migration 003a — organizations, org_members, org_api_settings, functions, vault helpers, seed orgs

**Files:**
- Create: `supabase/migrations/003_multi_tenant_foundation.sql` (this task writes the first section; Task 2 appends to the same file)

**Interfaces:**
- Produces: tables `organizations(id, name, use_global_api_fallback, created_by, created_at)`, `org_members(id, org_id, user_id, role, created_at)`, `org_api_settings(id, org_id, provider, is_configured, created_at, updated_at)`; SQL functions `is_org_admin(target_org uuid) returns boolean`, `is_org_member(target_org uuid) returns boolean`, `app_set_org_api_key(target_org uuid, target_provider text, secret text)`, `app_get_org_api_key(target_org uuid, target_provider text) returns text`; 4 seed rows in `organizations`.
- No existing table/policy is touched in this task — purely additive.
- **Deliberate deviation from the design doc's literal SQL sketch:** the design doc names `is_platform_admin()` as a concept; this plan does **not** create it as a SQL function. No RLS policy anywhere in this plan needs it (grep confirms — every policy checks `is_org_admin`/`is_org_member`, never platform admin), and every place that needs the platform-admin check (`admin-users` edge function, Task 4) already runs on the **service-role client**, which bypasses RLS entirely — so a `SECURITY DEFINER` RLS-context wrapper function would add a network round-trip for zero benefit over querying `profiles.platform_role` directly. If a future cycle adds a client-facing RLS policy that genuinely needs a platform-admin check, add the function then.

- [ ] **Step 1: Write the migration file (first section)**

`supabase/migrations/003_multi_tenant_foundation.sql`:

```sql
-- ─────────────────────────────────────────
-- CYCLE 3 PART A: organizations, membership, org API keys (additive — no
-- existing table, column, or policy is touched here)
-- ─────────────────────────────────────────

CREATE TABLE organizations (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                    TEXT NOT NULL,
  use_global_api_fallback BOOLEAN DEFAULT false,
  created_by              UUID REFERENCES profiles(id),
  created_at              TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "organizations_member_read" ON organizations FOR SELECT USING (
  EXISTS (SELECT 1 FROM org_members WHERE org_id = organizations.id AND user_id = auth.uid())
);

CREATE TABLE org_members (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id     UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT DEFAULT 'contractor' CHECK (role IN ('admin','contractor')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_self_read" ON org_members FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "org_members_admin_read" ON org_members FOR SELECT USING (
  EXISTS (SELECT 1 FROM org_members me WHERE me.org_id = org_members.org_id AND me.user_id = auth.uid() AND me.role = 'admin')
);
-- No client write policy: membership changes (invite/role-change) go through
-- the admin-users edge function (service role) only — see Task 4.

CREATE OR REPLACE FUNCTION is_org_admin(target_org UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM org_members WHERE org_id = target_org AND user_id = auth.uid() AND role = 'admin')
$$;

CREATE OR REPLACE FUNCTION is_org_member(target_org UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM org_members WHERE org_id = target_org AND user_id = auth.uid())
$$;

CREATE TABLE org_api_settings (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id        UUID REFERENCES organizations(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('gemini','google_places','companies_house')),
  is_configured BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, provider)
);
ALTER TABLE org_api_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_api_settings_member_read" ON org_api_settings FOR SELECT USING (is_org_member(org_id));
-- No client write policy: writes go through a dedicated edge function
-- (service role) — same pattern as user_email_settings/SMTP in cycle 2.

CREATE OR REPLACE FUNCTION app_set_org_api_key(target_org UUID, target_provider TEXT, secret TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE existing_id uuid; secret_name text := 'org_api_key_' || target_org::text || '_' || target_provider;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = secret_name;
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(secret, secret_name);
  ELSE
    PERFORM vault.update_secret(existing_id, secret);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_get_org_api_key(target_org UUID, target_provider TEXT)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'org_api_key_' || target_org::text || '_' || target_provider;
$$;

REVOKE ALL ON FUNCTION app_set_org_api_key(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_get_org_api_key(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_set_org_api_key(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION app_get_org_api_key(uuid, text) TO service_role;

INSERT INTO organizations (name, use_global_api_fallback) VALUES
  ('Digital Influx Dreamlabs', true),
  ('Mr Brush & Co', true),
  ('Digital Influx', false),
  ('UX Tree', false);
```

- [ ] **Step 2: Apply the migration to the live DB**

```bash
cd /c/Users/kevin/Projects/dreamlabs-sales
node -e "const fs=require('fs');fs.writeFileSync('query.json',JSON.stringify({query:fs.readFileSync('supabase/migrations/003_multi_tenant_foundation.sql','utf8')}))"
export $(grep -E '^SUPABASE_ACCESS_TOKEN=' .env)
curl -s -X POST "https://api.supabase.com/v1/projects/wgomksxelyfkzepbnkdd/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d @query.json
rm query.json
```

Expected: no `"message"` error key in the response.

- [ ] **Step 3: Verify**

Query: `select (select count(*) from organizations) as orgs, (select count(*) from pg_proc where proname in ('is_org_admin','is_org_member','app_set_org_api_key','app_get_org_api_key')) as fns;`
Expected: `[{"orgs":4,"fns":4}]`.

- [ ] **Step 4: Verify the existing app is untouched**

Open `http://localhost:5173` in the browser (Kevin's session), confirm the Dashboard, Pipeline, and Emails hub all load and show data exactly as before — this migration didn't touch any existing table, so nothing should look different.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/003_multi_tenant_foundation.sql
git commit -m "feat: multi-tenant foundation part A - organizations, membership, org api keys (additive)"
git push
```

---

### Task 2: Migration 003b — additive org_id columns, backfill, platform_role

**Files:**
- Modify: `supabase/migrations/003_multi_tenant_foundation.sql` (append)

**Interfaces:**
- Consumes: `organizations` (Task 1, specifically the "Digital Influx Dreamlabs" row).
- Produces: nullable `org_id` columns on `leads`, `scrape_jobs`, `email_logs`, `email_templates`, `email_sequences`; `profiles.platform_role` column (`'platform_admin'|'user'`, default `'user'`); every existing row backfilled into the Digital Influx Dreamlabs org; every existing profile added to `org_members` for that org, preserving their current `role`. **`profiles.role` is left completely untouched** — the old column, `is_admin()`, and every existing RLS policy keep working exactly as before after this task.

- [ ] **Step 1: Append to the migration file**

Append to `supabase/migrations/003_multi_tenant_foundation.sql`:

```sql
-- ─────────────────────────────────────────
-- CYCLE 3 PART B: additive org_id columns + backfill + platform_role.
-- Nullable/new-column-only — old code, old RLS policies, old profiles.role
-- and is_admin() are completely unaffected by this section.
-- ─────────────────────────────────────────

ALTER TABLE leads ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE scrape_jobs ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE email_logs ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE email_templates ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE email_sequences ADD COLUMN org_id UUID REFERENCES organizations(id);
-- email_templates/email_sequences.org_id stays nullable forever:
-- NULL = platform default (today's 5 templates / 2 sequences), unchanged.

ALTER TABLE profiles ADD COLUMN platform_role TEXT DEFAULT 'user' CHECK (platform_role IN ('platform_admin','user'));

DO $$
DECLARE di_org_id UUID;
BEGIN
  SELECT id INTO di_org_id FROM organizations WHERE name = 'Digital Influx Dreamlabs';

  UPDATE leads SET org_id = di_org_id WHERE org_id IS NULL;
  UPDATE scrape_jobs SET org_id = di_org_id WHERE org_id IS NULL;
  UPDATE email_logs SET org_id = di_org_id WHERE org_id IS NULL;
  UPDATE email_templates SET org_id = di_org_id WHERE org_id IS NULL AND is_default = false;
  UPDATE email_sequences SET org_id = di_org_id WHERE org_id IS NULL AND is_default = false;

  INSERT INTO org_members (org_id, user_id, role)
  SELECT di_org_id, id, role FROM profiles
  ON CONFLICT (org_id, user_id) DO NOTHING;

  UPDATE profiles SET platform_role = 'platform_admin' WHERE email = 'kevindigitalinflux@gmail.com';
END $$;
```

- [ ] **Step 2: Apply and verify**

Apply the same way as Task 1 Step 2 (the migration file now includes both sections — re-running the whole file is safe since every statement in Part A is `CREATE`/`INSERT` against brand-new objects that don't exist yet on a second run... but Part A already ran in Task 1. **Apply only Part B this time**: write just the newly-appended SQL text — from the `-- CYCLE 3 PART B` comment to the end of the file — to `query.json` and run it, so Part A isn't re-executed.)

Verify: `select (select count(*) from leads where org_id is not null) as leads_org, (select count(*) from org_members) as members, (select platform_role from profiles where email = (chr(107)||chr(101)||chr(118)||chr(105)||chr(110)||chr(100)||chr(105)||chr(103)||chr(105)||chr(116)||chr(97)||chr(108)||chr(105)||chr(110)||chr(102)||chr(108)||chr(117)||chr(120)||chr(64)||chr(103)||chr(109)||chr(97)||chr(105)||chr(108)||chr(46)||chr(99)||chr(111)||chr(109))) as kevin_role;`
Expected: `leads_org` equals the current total lead count, `members` ≥ 1, `kevin_role` = `"platform_admin"`.

- [ ] **Step 3: Verify the existing app is still fully unaffected**

Same browser check as Task 1 Step 4 — Dashboard/Pipeline/Emails all unchanged. This is the critical safety gate before any client code starts depending on the new schema.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/003_multi_tenant_foundation.sql
git commit -m "feat: multi-tenant foundation part B - org_id backfill, platform_role (additive, no behavior change)"
git push
```

---

### Task 3: `useOrg` hook, `OrgProvider`, org switcher UI

**Files:**
- Modify: `src/types/index.ts` (append)
- Create: `src/hooks/useOrg.tsx`
- Create: `src/components/layout/OrgSwitcher.tsx`
- Modify: `src/App.tsx` (mount `OrgProvider`)
- Modify: `src/components/layout/TopBar.tsx` (render the switcher)

**Interfaces:**
- Consumes: `organizations`/`org_members` tables (Task 1–2); `useAuth()` (`session`).
- Produces:
  - Types: `PlatformRole = 'platform_admin' | 'user'`; `OrgMembership = { id: string; name: string; role: Role }` (reuses the existing `Role` type — `org_members.role` and today's `profiles.role` share the same `'admin'|'contractor'` values).
  - `OrgProvider({ children })`, `useOrg(): { currentOrg: OrgMembership | null; orgs: OrgMembership[]; loading: boolean; switchOrg(orgId: string): void }` — on mount, queries `org_members` joined to `organizations` for the signed-in user; restores the last-selected org from `localStorage['current-org']` if it's still in the membership list, otherwise defaults to the first membership. `switchOrg` persists the choice the same way `focus-mode` does today.
  - `OrgSwitcher()` — renders nothing when `orgs.length <= 1`; otherwise a `SelectField`-style dropdown in the top bar.

- [ ] **Step 1: Append types to `src/types/index.ts`**

```ts
export type PlatformRole = 'platform_admin' | 'user';

export interface OrgMembership {
  id: string;
  name: string;
  role: Role;
}
```

- [ ] **Step 2: Update `Profile` to include `platform_role`**

In `src/types/index.ts`, add `platform_role: PlatformRole;` to the `Profile` interface (after `role: Role;` — both fields coexist during this cycle; `role` is removed only in Task 11).

- [ ] **Step 3: Write `src/hooks/useOrg.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { OrgMembership, Role } from '../types';

interface OrgContextValue {
  currentOrg: OrgMembership | null;
  orgs: OrgMembership[];
  loading: boolean;
  switchOrg: (orgId: string) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

interface MembershipRow {
  role: Role;
  organizations: { id: string; name: string };
}

/** Provides the signed-in user's org memberships and the currently-selected org. */
export function OrgProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      setOrgs([]);
      setCurrentOrgId(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void supabase
      .from('org_members')
      .select('role, organizations(id, name)')
      .eq('user_id', session.user.id)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data as MembershipRow[] | null) ?? [];
        const memberships = rows.map((r) => ({ id: r.organizations.id, name: r.organizations.name, role: r.role }));
        setOrgs(memberships);
        const saved = localStorage.getItem('current-org');
        const restored = memberships.find((m) => m.id === saved);
        setCurrentOrgId((restored ?? memberships[0])?.id ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const switchOrg = useCallback((orgId: string) => {
    localStorage.setItem('current-org', orgId);
    setCurrentOrgId(orgId);
  }, []);

  const currentOrg = orgs.find((o) => o.id === currentOrgId) ?? null;

  return (
    <OrgContext.Provider value={{ currentOrg, orgs, loading, switchOrg }}>
      {children}
    </OrgContext.Provider>
  );
}

/** Access the current org context; must be used inside OrgProvider. */
export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used inside OrgProvider');
  return ctx;
}
```

- [ ] **Step 4: Write `src/components/layout/OrgSwitcher.tsx`**

```tsx
import { Building2 } from 'lucide-react';
import { useOrg } from '../../hooks/useOrg';

/** Org switcher — renders nothing for single-org users. */
export function OrgSwitcher() {
  const { currentOrg, orgs, switchOrg } = useOrg();
  if (orgs.length <= 1) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <Building2 className="h-4 w-4 text-muted" aria-hidden />
      <select
        aria-label="Current organization"
        value={currentOrg?.id ?? ''}
        onChange={(e) => switchOrg(e.target.value)}
        className="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-2 text-sm font-semibold"
      >
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}
```

- [ ] **Step 5: Mount `OrgProvider` in `src/App.tsx`**

Add `import { OrgProvider } from './hooks/useOrg';` and wrap `<FocusModeProvider>`'s children with it — replace:
```tsx
<FocusModeProvider>
<Routes>
```
with:
```tsx
<FocusModeProvider>
<OrgProvider>
<Routes>
```
and its matching close (replace the closing `</FocusModeProvider>` block to also close `</OrgProvider>` immediately before it).

- [ ] **Step 6: Render the switcher in `src/components/layout/TopBar.tsx`**

Add `import { OrgSwitcher } from './OrgSwitcher';` and place `<OrgSwitcher />` immediately after the existing focus-mode button (before the user avatar `span`), inside the `<header>`.

- [ ] **Step 7: Verify in browser**

1. `npx tsc --noEmit && npx vitest run` pass.
2. Sign in as Kevin → no switcher visible yet (only 1 membership exists so far — Digital Influx Dreamlabs, from Task 2's backfill). This is expected; the switcher becomes visible once Task 7 (admin panel) is used to add Kevin to a second org, or verify manually via a DB insert of a second `org_members` row for Kevin into "Mr Brush & Co" and confirm the switcher now appears and switching persists across a refresh.

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/hooks/useOrg.tsx src/components/layout/OrgSwitcher.tsx src/App.tsx src/components/layout/TopBar.tsx
git commit -m "feat: org membership context, provider, and switcher UI"
git push
```

---

### Task 4: Org-scoped `admin-users` edge function

**Files:**
- Modify: `supabase/functions/admin-users/index.ts` (full rewrite)

**Interfaces:**
- Consumes: `organizations`, `org_members` (Task 1), `profiles.platform_role` (Task 2).
- Produces new actions (all POST, JWT-authed): `create_org` (`{name}` → `{org: {id, name}}`, platform-admin only); `list_orgs` (`{}` → `{orgs: {id, name}[]}` for platform admin, `{orgs: {id, name, role}[]}` for everyone else, scoped to their memberships); `invite` (`{org_id, org_role, email, full_name, redirect_to}` → `{ok:true}`, requires platform-admin or that org's admin); `set_org_role` (`{org_id, user_id, role}` → `{ok:true}`, same gating, can't target self); `list_org_members` (`{org_id}` → `{members: {role, created_at, profiles: {id,email,full_name,created_at}}[]}`, same gating). **The old `set_role` action is removed** — nothing calls it after Task 7 rewires the two client callers in the same deploy window (see note in Task 7).

- [ ] **Step 1: Rewrite `supabase/functions/admin-users/index.ts`**

```ts
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
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy admin-users
```

- [ ] **Step 3: Smoke test**

Sign in as Kevin via password grant (as in prior cycles) and call `list_orgs`:
```bash
curl -s -X POST "https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/admin-users" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"action":"list_orgs"}'
```
Expected: `{"orgs":[...4 orgs, sorted by name...]}` (Kevin is platform_admin, sees all 4).

- [ ] **Step 4: Note for Task 7**

The old `InviteModal.tsx`/`UserTable.tsx` still call the now-removed `'invite'`/`'set_role'` actions with the old (non-org-scoped) payload shape — they will get `{"error":"org_id is required"}`/similar until Task 7 rewires them. This is expected and acceptable within Phase A: the Admin panel is a low-traffic internal page Kevin uses occasionally, not the live pipeline/email surfaces the rest of Phase A protects. Task 7 fixes it before Phase A is considered complete.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/admin-users/index.ts
git commit -m "feat: org-scoped admin-users - create_org, list_orgs, org-scoped invite/set_org_role/list_org_members"
git push
```

---

### Task 5: Org-level API keys — settings page, edge function, AI key resolution

**Files:**
- Create: `supabase/functions/_shared/orgApiKeys.ts`
- Modify: `supabase/functions/_shared/ai.ts` (accept a resolved key instead of reading env)
- Modify: `supabase/functions/generate-email/index.ts`
- Modify: `supabase/functions/parse-notes/index.ts`
- Modify: `supabase/functions/check-sequences/index.ts`
- Create: `supabase/functions/org-api-settings/index.ts`
- Create: `src/hooks/useOrgApiSettings.ts`
- Create: `src/pages/OrganizationSettings.tsx`
- Modify: `src/App.tsx` (add `/settings/organization` route)
- Modify: `src/pages/Settings.tsx` (add a link card, admin-gated)

**Interfaces:**
- Consumes: `org_api_settings`, `app_get_org_api_key`/`app_set_org_api_key` (Task 1); `organizations.use_global_api_fallback` (Task 2); `useOrg()` (Task 3).
- Produces:
  - `resolveOrgApiKey(service, orgId, provider): Promise<string | null>` in `_shared/orgApiKeys.ts`.
  - `draftEmail`/`parseNotes` in `_shared/ai.ts` now take an `apiKey: string` field in their input and throw if the caller didn't resolve one (same "throws on failure → caller falls back" contract as before, just explicit about the key source).
  - `org-api-settings` edge function: `{action:'get'}` → `{settings: {provider, is_configured}[]}`; `{action:'save', provider, api_key}` → `{ok:true}` or `{error}` (runs a live validation call per provider before marking `is_configured`).
  - `useOrgApiSettings(): { settings, loading, save(provider, apiKey): Promise<string|null>, refresh() }`.

- [ ] **Step 1: Write `_shared/orgApiKeys.ts`**

```ts
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type ApiProvider = 'gemini' | 'google_places' | 'companies_house';

const GLOBAL_ENV_VARS: Record<ApiProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  google_places: 'GOOGLE_PLACES_API_KEY',
  companies_house: 'COMPANIES_HOUSE_API_KEY',
};

/**
 * Resolves the API key for an org + provider: the org's own Vault key if
 * configured, else the global env-var key IF the org is flagged to use the
 * global fallback. Returns null if no key is available either way — callers
 * must treat null as "this org needs to configure its own key" and degrade
 * gracefully, never throw.
 */
export async function resolveOrgApiKey(
  // deno-lint-ignore no-explicit-any
  service: SupabaseClient<any>, orgId: string, provider: ApiProvider,
): Promise<string | null> {
  const { data: settings } = await service
    .from('org_api_settings').select('is_configured').eq('org_id', orgId).eq('provider', provider).maybeSingle();
  if (settings?.is_configured) {
    const { data: key } = await service.rpc('app_get_org_api_key', { target_org: orgId, target_provider: provider });
    if (key) return key as string;
  }
  const { data: org } = await service.from('organizations').select('use_global_api_fallback').eq('id', orgId).single();
  if (org?.use_global_api_fallback) return Deno.env.get(GLOBAL_ENV_VARS[provider]) ?? null;
  return null;
}
```

- [ ] **Step 2: Update `_shared/ai.ts` to take a resolved key**

Replace the `geminiJson` function and both callers' signatures:

```ts
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const AI_MODEL = 'gemini-2.5-flash';

async function geminiJson(prompt: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${GEMINI_URL}/${AI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');
  return JSON.parse(text);
}

/** Personalises an already-variable-substituted draft using lead context + notes. Throws on failure. */
export async function draftEmail(input: {
  subject: string; body: string; lead: Record<string, unknown>; notes: string[]; contractorName: string; apiKey: string;
}): Promise<{ subject: string; body: string }> {
  const result = await geminiJson(
`You are a sales assistant for Digital Influx Dreamlabs, a UK agency selling automation/AI systems to small businesses.
Personalise this follow-up email using the lead data and call notes. Keep it plain text, warm, brief, UK English.
Do not invent facts not present in the data. Keep any URLs intact. Return JSON: {"subject": string, "body": string}.

LEAD: ${JSON.stringify(input.lead)}
RECENT CALL NOTES (newest first): ${JSON.stringify(input.notes)}
SENDER NAME: ${input.contractorName}
DRAFT SUBJECT: ${input.subject}
DRAFT BODY:
${input.body}`,
    input.apiKey,
  ) as { subject?: string; body?: string };
  if (!result.subject || !result.body) throw new Error('Gemini draft missing fields');
  return { subject: result.subject, body: result.body };
}

/** Suggests lead field updates from a note. Throws on failure. */
export async function parseNotes(input: { note: string; lead: Record<string, unknown>; apiKey: string }): Promise<Record<string, unknown>> {
  return await geminiJson(
`You extract CRM field updates from a sales call note. Compare the note against the current lead and output ONLY fields that should change, as JSON with any of these keys:
stage (one of: new_lead, contacted, audit_booked, proposal_sent, negotiating, won, lost, not_now_nurture),
deal_value (number, GBP), package_tier (one of: pilot_systems, pilot_ai_app, pilot_full_build, automation_sprint, ai_foundation, full_build, retainer_bronze, retainer_silver, retainer_gold, custom),
next_action_date (YYYY-MM-DD), next_action_note (string), pain_point (string),
rationale (string, ALWAYS present: one sentence explaining the suggestions).
Suggest nothing you are not confident about. Today is ${new Date().toISOString().slice(0, 10)}.

CURRENT LEAD: ${JSON.stringify(input.lead)}
NOTE:
${input.note}`,
    input.apiKey,
  ) as Record<string, unknown>;
}
```

- [ ] **Step 3: Update `generate-email/index.ts` to resolve the org's key**

Add the import and a service client, and change the AI branch. Replace:
```ts
import { draftEmail } from '../_shared/ai.ts';
```
with:
```ts
import { draftEmail } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
```
After the existing `client` (anon/JWT) is created, add a service client (used only for key resolution):
```ts
  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
```
Replace the final AI branch:
```ts
  if (body.use_ai === false) {
    return json({ subject: subject.text, body: bodyText.text, ai_used: false, missing }, 200, headers);
  }
  const apiKey = await resolveOrgApiKey(service, (lead as { org_id: string }).org_id, 'gemini');
  if (!apiKey) {
    return json({ subject: subject.text, body: bodyText.text, ai_used: false, missing }, 200, headers);
  }
  try {
    const ai = await draftEmail({ subject: subject.text, body: bodyText.text, lead: lead as Record<string, unknown>, notes: noteTexts, contractorName, apiKey });
    return json({ subject: ai.subject, body: ai.body, ai_used: true, missing }, 200, headers);
  } catch (e) {
    console.error('draftEmail failed, falling back to plain template:', e);
    return json({ subject: subject.text, body: bodyText.text, ai_used: false, missing }, 200, headers);
  }
```

- [ ] **Step 4: Update `parse-notes/index.ts` the same way**

Add `import { createClient } from 'npm:@supabase/supabase-js@2';` and `import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';` at the top. Replace the try block:
```ts
  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const apiKey = await resolveOrgApiKey(service, (lead as { org_id: string }).org_id, 'gemini');
  if (!apiKey) return json({ suggestion: null, error: 'AI unavailable' }, 200, headers);
  try {
    const suggestion = await parseNotes({ note: String(body.note ?? ''), lead: lead as Record<string, unknown>, apiKey });
    return json({ suggestion }, 200, headers);
  } catch (e) {
    console.error('parse-notes failed:', e);
    return json({ suggestion: null, error: 'AI unavailable' }, 200, headers);
  }
```

- [ ] **Step 5: Update `check-sequences/index.ts`**

Add `import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';`. Replace the AI block:
```ts
    let finalSubject = subject.text;
    let finalBody = bodyText.text;
    const apiKey = await resolveOrgApiKey(service, lead.org_id as string, 'gemini');
    if (apiKey) {
      try {
        const ai = await draftEmail({ subject: subject.text, body: bodyText.text, lead, notes: noteTexts, contractorName, apiKey });
        finalSubject = ai.subject; finalBody = ai.body;
      } catch (e) {
        console.error(`AI draft failed for enrollment ${enrollment.id}, using plain template:`, e);
      }
    }
```

- [ ] **Step 6: Write the `org-api-settings` edge function**

`supabase/functions/org-api-settings/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

type Provider = 'gemini' | 'google_places' | 'companies_house';

async function validateKey(provider: Provider, key: string): Promise<string | null> {
  try {
    if (provider === 'gemini') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }] }) },
      );
      return res.ok ? null : `Gemini rejected the key (HTTP ${res.status})`;
    }
    if (provider === 'google_places') {
      const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=test&key=${key}`);
      const data = await res.json() as { status?: string };
      return data.status === 'REQUEST_DENIED' || data.status === 'INVALID_REQUEST' ? `Google rejected the key (${data.status})` : null;
    }
    // companies_house — HTTP Basic auth, API key as username, empty password
    const res = await fetch('https://api.company-information.service.gov.uk/search/companies?q=test', {
      headers: { Authorization: 'Basic ' + btoa(`${key}:`) },
    });
    return res.ok ? null : `Companies House rejected the key (HTTP ${res.status})`;
  } catch (e) {
    return 'Could not reach the provider to validate the key: ' + (e instanceof Error ? e.message : String(e));
  }
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
  if (!userData?.user) return json({ error: 'Not signed in' }, 401, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const body = (await req.json()) as Record<string, unknown>;
  const orgId = String(body.org_id ?? '');
  if (!orgId) return json({ error: 'org_id is required' }, 400, headers);

  const { data: membership } = await service
    .from('org_members').select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  const { data: profile } = await service.from('profiles').select('platform_role').eq('id', userData.user.id).single();
  const canManage = membership?.role === 'admin' || profile?.platform_role === 'platform_admin';
  if (!canManage) return json({ error: 'Org admin only' }, 403, headers);

  if (body.action === 'get') {
    const { data, error } = await service.from('org_api_settings').select('provider, is_configured').eq('org_id', orgId);
    if (error) return json({ error: error.message }, 400, headers);
    return json({ settings: data }, 200, headers);
  }

  if (body.action === 'save') {
    const provider = String(body.provider ?? '') as Provider;
    const apiKey = String(body.api_key ?? '').trim();
    if (!['gemini', 'google_places', 'companies_house'].includes(provider)) return json({ error: 'Invalid provider' }, 400, headers);
    if (!apiKey) return json({ error: 'api_key is required' }, 400, headers);

    const validationError = await validateKey(provider, apiKey);
    if (validationError) return json({ error: validationError }, 400, headers);

    const { error: vaultErr } = await service.rpc('app_set_org_api_key', { target_org: orgId, target_provider: provider, secret: apiKey });
    if (vaultErr) return json({ error: 'Could not store the key: ' + vaultErr.message }, 500, headers);
    const { error: upsertErr } = await service.from('org_api_settings').upsert(
      { org_id: orgId, provider, is_configured: true, updated_at: new Date().toISOString() },
      { onConflict: 'org_id,provider' },
    );
    if (upsertErr) return json({ error: upsertErr.message }, 400, headers);
    return json({ ok: true }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
```

- [ ] **Step 7: Deploy all 4 functions**

```bash
npx supabase functions deploy generate-email
npx supabase functions deploy parse-notes
npx supabase functions deploy check-sequences
npx supabase functions deploy org-api-settings
```

- [ ] **Step 8: Write `src/hooks/useOrgApiSettings.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';

export interface OrgApiSetting {
  provider: 'gemini' | 'google_places' | 'companies_house';
  is_configured: boolean;
}

/** BYO API key status for the current org (Gemini/Places/Companies House). Save validates live. */
export function useOrgApiSettings() {
  const { currentOrg } = useOrg();
  const [settings, setSettings] = useState<OrgApiSetting[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    const { data, error } = await supabase.functions.invoke('org-api-settings', {
      body: { action: 'get', org_id: currentOrg.id },
    });
    if (!error) setSettings((data as { settings: OrgApiSetting[] }).settings);
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (provider: OrgApiSetting['provider'], apiKey: string): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    const { data, error } = await supabase.functions.invoke('org-api-settings', {
      body: { action: 'save', org_id: currentOrg.id, provider, api_key: apiKey },
    });
    if (error) return error.message;
    const err = (data as { error?: string }).error;
    if (err) return err;
    await refresh();
    return null;
  }, [currentOrg, refresh]);

  return { settings, loading, save, refresh };
}
```

- [ ] **Step 9: Write `src/pages/OrganizationSettings.tsx`**

```tsx
import { useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { useOrgApiSettings } from '../hooks/useOrgApiSettings';
import type { OrgApiSetting } from '../hooks/useOrgApiSettings';
import { useOrg } from '../hooks/useOrg';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';

const PROVIDERS: { key: OrgApiSetting['provider']; label: string; hint: string }[] = [
  { key: 'gemini', label: 'Gemini (AI drafting)', hint: 'Free key from aistudio.google.com/apikey' },
  { key: 'google_places', label: 'Google Places (lead scraper)', hint: 'From Google Cloud Console — $200/month free credit' },
  { key: 'companies_house', label: 'Companies House (lead scraper)', hint: 'Free key from developer.company-information.service.gov.uk' },
];

function ProviderRow({ provider, label, hint, configured, onSave }: {
  provider: OrgApiSetting['provider']; label: string; hint: string; configured: boolean;
  onSave: (provider: OrgApiSetting['provider'], key: string) => Promise<string | null>;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function handleSave() {
    if (!key.trim()) return setMsg({ kind: 'err', text: 'Enter a key first.' });
    setBusy(true); setMsg(null);
    const err = await onSave(provider, key.trim());
    setBusy(false);
    if (err) return setMsg({ kind: 'err', text: err });
    setKey('');
    setMsg({ kind: 'ok', text: 'Key verified and saved.' });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-4">
      <div className="flex items-center gap-2">
        <p className="font-semibold">{label}</p>
        {configured && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 className="h-3 w-3" aria-hidden /> Configured
          </span>
        )}
      </div>
      <p className="text-xs text-muted">{hint}</p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input label="API key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={configured ? 'Replace the saved key' : ''} />
        </div>
        <Button variant="secondary" onClick={() => void handleSave()} disabled={busy}>{busy ? 'Verifying…' : 'Save'}</Button>
      </div>
      {msg && <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>}
    </div>
  );
}

/** Org-level BYO API keys (Gemini/Places/Companies House) — org-admin only. */
export function OrganizationSettings() {
  const { currentOrg } = useOrg();
  const { settings, loading, save } = useOrgApiSettings();

  if (loading) return <Skeleton className="h-80 w-full max-w-2xl" />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <KeyRound className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">{currentOrg?.name} — API keys</h1>
      </header>
      <p className="text-muted">
        These keys power AI drafting and the lead scraper for this organization. Usage bills to
        whichever key is configured here — never to Kevin's account.
      </p>
      <Card>
        <div className="flex flex-col gap-3">
          {PROVIDERS.map((p) => (
            <ProviderRow
              key={p.key}
              provider={p.key}
              label={p.label}
              hint={p.hint}
              configured={settings.find((s) => s.provider === p.key)?.is_configured ?? false}
              onSave={save}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 10: Wire the route + Settings link**

In `src/App.tsx`: add `import { OrganizationSettings } from './pages/OrganizationSettings';` and, next to `/settings/email`: `<Route path="/settings/organization" element={<OrganizationSettings />} />`.

In `src/pages/Settings.tsx`: add a `Link` card to `/settings/organization` (same style as the existing "Email sending" card), titled "Organization API keys", gated to render only when `useOrg().currentOrg?.role === 'admin'` (import `useOrg` there).

- [ ] **Step 11: Verify in browser + typecheck**

1. `npx tsc --noEmit && npx vitest run` pass.
2. `/settings/organization` (as Kevin, admin of Digital Influx Dreamlabs) shows all 3 providers, none configured yet.
3. Save an intentionally-invalid Gemini key → clear validation error shown, `is_configured` stays false (verify via SQL runner: `select * from org_api_settings`).
4. **If Kevin provides a real Gemini key here or via `npx supabase secrets set` at this point**: save it → "Key verified and saved", `is_configured=true`; then in the pipeline, open a lead's email composer → "Personalise with AI" → `ai_used: true`. If no real key is available yet, confirm the existing global-fallback path still works exactly as before (Digital Influx Dreamlabs has `use_global_api_fallback=true`, so `ai_used` behavior is unchanged from before this task).

- [ ] **Step 12: Commit**

```bash
git add supabase/functions/_shared/orgApiKeys.ts supabase/functions/_shared/ai.ts supabase/functions/generate-email supabase/functions/parse-notes supabase/functions/check-sequences supabase/functions/org-api-settings src/hooks/useOrgApiSettings.ts src/pages/OrganizationSettings.tsx src/App.tsx src/pages/Settings.tsx
git commit -m "feat: org-level BYO API keys - settings page, edge function, AI key resolution with global fallback"
git push
```

---

### Task 6: Google Sign-In (invite-only guardrail)

**Files:**
- Modify: `src/pages/Login.tsx` (add the Google button)
- Create: `src/pages/AuthCallback.tsx`
- Modify: `src/App.tsx` (add `/auth/callback` route)

**Interfaces:**
- Consumes: `useAuth()` (`session`); `org_members` table (Task 1).
- Produces: `AuthCallback` page — the landing target for Supabase's OAuth redirect; enforces that a Google sign-in is only ever useful for someone who already has at least one `org_members` row.

- [ ] **Step 1: HUMAN STEP — Google Cloud OAuth client (Kevin)**

Kevin creates an OAuth 2.0 Client ID in Google Cloud Console (APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application), adds
`https://wgomksxelyfkzepbnkdd.supabase.co/auth/v1/callback` as an authorized redirect URI, then in the Supabase dashboard (Authentication → Providers → Google) pastes the client ID and secret and enables the provider. This step must be done before Step 6's browser verification; note it as pending in your report if it isn't done yet and verify everything else (the button renders, links to the right place) without a live Google account.

- [ ] **Step 2: Add the Google button to `src/pages/Login.tsx`**

Add `import { Chrome } from 'lucide-react';` (used as a generic "Google" glyph — no brand-asset dependency) and a `signInWithGoogle` handler:

```tsx
async function handleGoogleSignIn() {
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
}
```

(add `import { supabase } from '../lib/supabase';` at the top). Insert after the existing form's closing `</div>` (still inside the `<form>`'s wrapping card, before the outer `</form>`... concretely: after the `<Button type="submit">…</Button>` block and before the form's closing tags, add a divider and the button:

```tsx
          <div className="my-1 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
          </div>
          <Button type="button" variant="secondary" className="w-full" onClick={() => void handleGoogleSignIn()}>
            <Chrome className="h-4 w-4" aria-hidden />
            Sign in with Google
          </Button>
```

- [ ] **Step 3: Write `src/pages/AuthCallback.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Skeleton } from '../components/ui/Skeleton';

/**
 * Landing page for the Google OAuth redirect. Guardrail: a Google sign-in
 * only succeeds if the resulting account already has at least one
 * org_members row — this app is invite-only, Google Sign-In is just a login
 * method, never a self-registration path.
 */
export function AuthCallback() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'checking' | 'denied'>('checking');

  useEffect(() => {
    if (loading || !session) return;
    let cancelled = false;
    void supabase
      .from('org_members').select('id', { count: 'exact', head: true }).eq('user_id', session.user.id)
      .then(async ({ count }) => {
        if (cancelled) return;
        if (!count) {
          await supabase.auth.signOut();
          setStatus('denied');
        } else {
          navigate('/', { replace: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, loading, navigate]);

  if (status === 'denied') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl border border-line bg-card p-8 text-center">
          <h1 className="mb-2 text-[18px] font-bold">Not invited yet</h1>
          <p className="text-sm text-muted">
            This Google account hasn't been invited to Dreamlabs Sales. Ask your organization's
            admin to send you an invite, then try again.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Skeleton className="h-24 w-72" />
    </div>
  );
}
```

- [ ] **Step 4: Route it in `src/App.tsx`**

Add `import { AuthCallback } from './pages/AuthCallback';` and, alongside `/login`/`/welcome` (outside `ProtectedRoute`, since the session may still be settling when this page first renders): `<Route path="/auth/callback" element={<AuthCallback />} />`.

- [ ] **Step 5: Typecheck**

`npx tsc --noEmit && npx vitest run` pass.

- [ ] **Step 6: Verify in browser**

1. `/login` shows the divider + "Sign in with Google" button beneath the existing form.
2. **If Step 1's human setup is done**: click it → Google's consent screen → for `kevindigitalinflux@gmail.com` (already has `org_members`) → lands on `/auth/callback` briefly → redirected to `/`. For a Google account with no invite, lands on the "Not invited yet" screen and is signed out (confirm via `supabase.auth.getSession()` in the browser console returning `null` afterward).
3. If Step 1 isn't done yet: confirm the button click doesn't crash the app (it'll show Supabase's own "provider not enabled" error) — note this as pending in your report.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Login.tsx src/pages/AuthCallback.tsx src/App.tsx
git commit -m "feat: google sign-in with invite-only membership guardrail"
git push
```

---

### Task 7: Admin panel rework — org-scoped membership + new-org bootstrapping

**Files:**
- Modify: `src/pages/Admin.tsx` (full rewrite)
- Modify: `src/components/admin/UserTable.tsx` (full rewrite)
- Modify: `src/components/admin/InviteModal.tsx` (add org_id + org_role)
- Modify: `src/components/admin/AssignmentPanel.tsx` (contractors list now comes from a prop, not `useProfiles`)
- Create: `src/components/admin/NewOrgModal.tsx`

**Interfaces:**
- Consumes: `admin-users` actions `list_orgs`/`invite`/`set_org_role`/`list_org_members`/`create_org` (Task 4); `useOrg()` (Task 3).
- Produces: `OrgMemberRow = { role: Role; created_at: string; profiles: { id: string; email: string; full_name: string | null; created_at: string } }` (append to `src/types/index.ts`).
- **Two independent org scopes on this one page** (deliberate, not an oversight — call this out in the PR description): the "manage members of…" selector lets a platform admin pick *any* org (including ones they aren't operationally working in) to invite that org's first admin. Lead assignment always uses `useOrg().currentOrg` — the org selected in the top bar — since you can only assign leads you can actually see.

- [ ] **Step 1: Append the type to `src/types/index.ts`**

```ts
export interface OrgMemberRow {
  role: Role;
  created_at: string;
  profiles: { id: string; email: string; full_name: string | null; created_at: string };
}
```

- [ ] **Step 2: Rewrite `src/pages/Admin.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Building2, UserPlus, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useOrg } from '../hooks/useOrg';
import type { OrgMemberRow } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SelectField } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { UserTable } from '../components/admin/UserTable';
import { InviteModal } from '../components/admin/InviteModal';
import { NewOrgModal } from '../components/admin/NewOrgModal';
import { AssignmentPanel } from '../components/admin/AssignmentPanel';

interface OrgOption { id: string; name: string }

/** Admin panel: org-scoped user management + lead assignment (SPEC.md §10). */
export function Admin() {
  const { profile } = useAuth();
  const { currentOrg } = useOrg();
  const isPlatformAdmin = profile?.platform_role === 'platform_admin';

  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [manageOrgId, setManageOrgId] = useState<string>('');
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [newOrgOpen, setNewOrgOpen] = useState(false);

  const [currentOrgContractors, setCurrentOrgContractors] = useState<{ id: string; full_name: string | null; email: string }[]>([]);

  const loadOrgs = useCallback(async () => {
    const { data, error: err } = await supabase.functions.invoke('admin-users', { body: { action: 'list_orgs' } });
    setLoadingOrgs(false);
    if (err) return setError(err.message);
    const orgs = (data as { orgs: OrgOption[] }).orgs;
    setOrgOptions(orgs);
    setManageOrgId((prev) => prev || currentOrg?.id || orgs[0]?.id || '');
  }, [currentOrg]);

  const loadMembers = useCallback(async (orgId: string) => {
    if (!orgId) return;
    setLoadingMembers(true);
    const { data, error: err } = await supabase.functions.invoke('admin-users', { body: { action: 'list_org_members', org_id: orgId } });
    setLoadingMembers(false);
    if (err) return setError(err.message);
    setMembers((data as { members: OrgMemberRow[] }).members);
  }, []);

  useEffect(() => { void loadOrgs(); }, [loadOrgs]);
  useEffect(() => { if (manageOrgId) void loadMembers(manageOrgId); }, [manageOrgId, loadMembers]);

  useEffect(() => {
    if (!currentOrg) return;
    void supabase.functions.invoke('admin-users', { body: { action: 'list_org_members', org_id: currentOrg.id } })
      .then(({ data }) => {
        const rows = (data as { members: OrgMemberRow[] } | null)?.members ?? [];
        setCurrentOrgContractors(rows.filter((r) => r.role === 'contractor').map((r) => r.profiles));
      });
  }, [currentOrg]);

  if (loadingOrgs) return <Skeleton className="h-40 w-full max-w-4xl" />;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Admin</h1>
        <div className="flex items-center gap-2">
          {isPlatformAdmin && (
            <Button variant="secondary" onClick={() => setNewOrgOpen(true)}>
              <Building2 className="h-4 w-4" aria-hidden />
              New organization
            </Button>
          )}
          <Button onClick={() => setInviteOpen(true)} disabled={!manageOrgId}>
            <UserPlus className="h-4 w-4" aria-hidden />
            Invite
          </Button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[18px] font-bold">Members</h2>
          {isPlatformAdmin && orgOptions.length > 1 && (
            <div className="w-64">
              <SelectField label="Manage members of" value={manageOrgId} onChange={(e) => setManageOrgId(e.target.value)}>
                {orgOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </SelectField>
            </div>
          )}
        </div>
        {loadingMembers && <Skeleton className="h-40 w-full" />}
        {!loadingMembers && members.length === 0 && (
          <EmptyState icon={Users} title="No members yet" hint="Invite the first person to this organization." />
        )}
        {!loadingMembers && members.length > 0 && (
          <UserTable members={members} orgId={manageOrgId} onChanged={() => void loadMembers(manageOrgId)} />
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-[18px] font-bold">Lead assignment {currentOrg ? `— ${currentOrg.name}` : ''}</h2>
        <AssignmentPanel contractors={currentOrgContractors} />
      </Card>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} orgId={manageOrgId} onInvited={() => void loadMembers(manageOrgId)} />
      {isPlatformAdmin && (
        <NewOrgModal open={newOrgOpen} onClose={() => setNewOrgOpen(false)} onCreated={(org) => { setManageOrgId(org.id); void loadOrgs(); }} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `src/components/admin/UserTable.tsx`**

```tsx
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { OrgMemberRow, Role } from '../../types';
import { formatShortDate } from '../../lib/utils';
import { useAuth } from '../../hooks/useAuth';

interface UserTableProps {
  members: OrgMemberRow[];
  orgId: string;
  onChanged: () => void;
}

/** Org member list with per-row role editing (via admin-users' set_org_role action). */
export function UserTable({ members, orgId, onChanged }: UserTableProps) {
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setRole(userId: string, role: Role) {
    setBusyId(userId);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('admin-users', {
      body: { action: 'set_org_role', org_id: orgId, user_id: userId, role },
    });
    setBusyId(null);
    const apiError = err?.message ?? (data as { error?: string } | null)?.error;
    if (apiError) setError(apiError);
    else onChanged();
  }

  return (
    <div className="overflow-x-auto">
      {error && <p role="alert" className="mb-2 text-sm text-red-400">{error}</p>}
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs font-semibold text-muted">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Joined</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.profiles.id} className="border-b border-line">
              <td className="px-3 py-3 font-semibold">{m.profiles.full_name ?? '—'}</td>
              <td className="px-3 py-3 text-muted">{m.profiles.email}</td>
              <td className="px-3 py-3">
                <select
                  aria-label={`Role for ${m.profiles.email}`}
                  className="min-h-11 rounded-lg border border-line bg-surface px-2"
                  value={m.role}
                  disabled={m.profiles.id === session?.user.id || busyId === m.profiles.id}
                  onChange={(e) => void setRole(m.profiles.id, e.target.value as Role)}
                >
                  <option value="contractor">Contractor</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td className="px-3 py-3 text-muted">{formatShortDate(m.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Update `src/components/admin/InviteModal.tsx`**

Add an `orgId: string` prop and an org-role select. Replace the props interface and submit body:
```tsx
interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  onInvited: () => void;
}
```
Add `const [orgRole, setOrgRole] = useState<'admin' | 'contractor'>('contractor');` alongside the existing `fullName`/`email` state, add `import { SelectField } from '../ui/Input';` (alongside the existing `Input` import), and change the invoke body:
```tsx
      body: {
        action: 'invite',
        org_id: orgId,
        org_role: orgRole,
        email,
        full_name: fullName,
        redirect_to: `${window.location.origin}/welcome`,
      },
```
Reset `setOrgRole('contractor')` alongside the existing `setFullName('')`/`setEmail('')` resets. Add the select to the form, after the `full_name`/`email` inputs and before the error/submit block:
```tsx
        <SelectField label="Role" value={orgRole} onChange={(e) => setOrgRole(e.target.value as 'admin' | 'contractor')}>
          <option value="contractor">Contractor</option>
          <option value="admin">Admin</option>
        </SelectField>
```

- [ ] **Step 5: Write `src/components/admin/NewOrgModal.tsx`**

```tsx
import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

interface NewOrgModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (org: { id: string; name: string }) => void;
}

/** Platform-admin-only: create a brand new organization. */
export function NewOrgModal({ open, onClose, onCreated }: NewOrgModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('admin-users', { body: { action: 'create_org', name } });
    setSubmitting(false);
    const apiError = err?.message ?? (data as { error?: string } | null)?.error;
    if (apiError) return setError(apiError);
    const org = (data as { org: { id: string; name: string } }).org;
    setName('');
    onCreated(org);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="New organization">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Organization name" value={name} onChange={(e) => setName(e.target.value)} required />
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create organization'}</Button>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 6: Update `src/components/admin/AssignmentPanel.tsx`**

Replace the `profiles: Profile[]` prop with a narrower `contractors: { id: string; full_name: string | null; email: string }[]` prop (drop the `Profile` import, `type` import stays if still needed elsewhere in the file — it isn't, so remove `import type { Lead, Profile } from '../../types';` and replace with `import type { Lead } from '../../types';`). Change the function signature:
```tsx
export function AssignmentPanel({ contractors }: { contractors: { id: string; full_name: string | null; email: string }[] }) {
```
and the dropdown's `.map`:
```tsx
          {contractors.map((p) => (
```
(same body otherwise — `p.full_name`/`p.email`/`p.id` all still exist on the narrower shape).

- [ ] **Step 7: Verify in browser**

1. `npx tsc --noEmit && npx vitest run` pass.
2. `/admin` as Kevin (platform admin) → org selector visible with all 4 orgs (since `orgOptions.length > 1`), defaults to Digital Influx Dreamlabs. Members table shows Kevin (and anyone else backfilled in Task 2).
3. Click "New organization" → create a test org → selector now includes it, members table empty with the EmptyState.
4. Invite someone into that test org with role "admin" → check via SQL runner that `org_members` has the right row; invite email lands (same invite mechanism as cycles 1–2, unchanged).
5. Switch "Manage members of" back to Digital Influx Dreamlabs → change a member's role → table updates.
6. Lead assignment section shows unassigned leads for `currentOrg` (Digital Influx Dreamlabs) and the contractor dropdown lists that org's contractors.
7. Clean up any test org/invite created during verification if it's not meant to persist (ask in the report rather than deleting Kevin's real data unprompted).

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/pages/Admin.tsx src/components/admin/UserTable.tsx src/components/admin/InviteModal.tsx src/components/admin/NewOrgModal.tsx src/components/admin/AssignmentPanel.tsx
git commit -m "feat: org-scoped admin panel - membership management, new-org bootstrapping"
git push
```

**Phase A complete after this task.** Every table's data is backfilled, every new capability (org context, org API keys, Google sign-in, org-scoped admin) exists and works, and the app has been fully functional and unchanged from Kevin's point of view throughout. Phase B (Tasks 8–11) is the RLS cutover.

---

### Task 8: RLS cutover — leads + lead_notes

**Files:**
- Modify: `supabase/migrations/003_multi_tenant_foundation.sql` (append)
- Modify: `src/hooks/useLeads.ts`
- Modify: `src/components/admin/AssignmentPanel.tsx`
- Modify: `src/components/pipeline/LeadPanel.tsx`
- Modify: `src/components/pipeline/FilterBar.tsx`

**Interfaces:**
- Consumes: `is_org_admin`/`is_org_member` (Task 1); `useOrg()` (Task 3).
- Produces: `leads.org_id`/`lead_notes` (via join) now enforced by org-scoped RLS; `useLeads()` scoped to `currentOrg`; `AssignmentPanel` fetches its own org-scoped unassigned-leads list (`useOrg` import) instead of a global query.

- [ ] **Step 1: Append the RLS cutover SQL**

Append to `supabase/migrations/003_multi_tenant_foundation.sql`:

```sql
-- ─────────────────────────────────────────
-- CYCLE 3 PART C (Task 8): leads + lead_notes RLS cutover
-- ─────────────────────────────────────────

ALTER TABLE leads ALTER COLUMN org_id SET NOT NULL;

DROP POLICY "leads_own" ON leads;
DROP POLICY "leads_admin" ON leads;
CREATE POLICY "leads_org_admin" ON leads FOR ALL USING (is_org_admin(org_id));
CREATE POLICY "leads_own_in_org" ON leads FOR ALL USING (
  is_org_member(org_id) AND (auth.uid() = created_by OR auth.uid() = assigned_to)
);

DROP POLICY "notes_lead_access" ON lead_notes;
DROP POLICY "notes_admin" ON lead_notes;
CREATE POLICY "notes_org_admin" ON lead_notes FOR ALL USING (
  EXISTS (SELECT 1 FROM leads WHERE id = lead_notes.lead_id AND is_org_admin(leads.org_id))
);
CREATE POLICY "notes_own_in_org" ON lead_notes FOR ALL USING (
  EXISTS (
    SELECT 1 FROM leads
    WHERE id = lead_notes.lead_id AND is_org_member(leads.org_id)
    AND (leads.created_by = auth.uid() OR leads.assigned_to = auth.uid())
  )
);
```

- [ ] **Step 2: Apply just this section (not the earlier parts of the file) and verify**

Apply following the same "write only the newly-appended text to query.json" approach as Task 2. Verify:
`select count(*) from leads;` as Kevin (via a JWT-authed REST call, not the management API which bypasses RLS) still returns the same count as before this task — confirms the org-scoped policy correctly includes him as Digital Influx Dreamlabs' admin.

- [ ] **Step 3: Update `src/hooks/useLeads.ts`**

Add `import { useOrg } from './useOrg';` and `const { currentOrg } = useOrg();` inside `useLeads`. Change `refresh`:
```ts
  const refresh = useCallback(async () => {
    if (!currentOrg) { setLeads([]); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('leads').select('*').eq('org_id', currentOrg.id).order('kanban_position').order('created_at');
    if (err) setError(err.message);
    else { setLeads(data as Lead[]); setError(null); }
    setLoading(false);
  }, [currentOrg]);
```
Change the `refresh` dependency array in the `useEffect` below it stays `[refresh]` (unchanged — `refresh` itself now depends on `currentOrg`, so the effect re-subscribes correctly when the org changes). Change `createLead`:
```ts
  const createLead = useCallback(
    async (input: LeadInput): Promise<string | null> => {
      if (!currentOrg) return 'No organization selected';
      const stage = input.stage ?? 'new_lead';
      const maxPos = Math.max(0, ...leads.filter((l) => l.stage === stage).map((l) => l.kanban_position));
      const { error: err } = await supabase.from('leads').insert({
        ...input,
        stage,
        kanban_position: maxPos + 1,
        created_by: session?.user.id,
        org_id: currentOrg.id,
      });
      if (err) return err.message;
      await refresh();
      return null;
    },
    [leads, session, currentOrg, refresh],
  );
```
(`updateLead` is unchanged — it patches an existing row, which already has the right `org_id`.)

- [ ] **Step 4: Update `src/components/admin/AssignmentPanel.tsx`**

Add `import { useOrg } from '../../hooks/useOrg';` and `const { currentOrg } = useOrg();` inside the component. Change `load`'s query to filter by org:
```tsx
  const load = useCallback(async () => {
    if (!currentOrg) return;
    const { data, error: err } = await supabase
      .from('leads').select('*').eq('org_id', currentOrg.id).is('assigned_to', null).order('created_at');
    if (err) setError(err.message);
    else setUnassigned(data as Lead[]);
    setLoading(false);
  }, [currentOrg]);
```

- [ ] **Step 5: Update `src/components/pipeline/LeadPanel.tsx`**

Add `import { useOrg } from '../../hooks/useOrg';` and `const { currentOrg } = useOrg();` alongside the existing `const { profile: me } = useAuth();`. Replace `{me?.role === 'admin' && (` (the Assignment section gate) with `{currentOrg?.role === 'admin' && (`. Leave line 81's `profiles.filter((p) => p.role === 'contractor')` untouched for now — it's fixed automatically once Task 11 makes `useProfiles()` org-scoped.

- [ ] **Step 6: Update `src/components/pipeline/FilterBar.tsx`**

Add `import { useOrg } from '../../hooks/useOrg';` and `const { currentOrg } = useOrg();` alongside `const { profile: me } = useAuth();`. Replace `{me?.role === 'admin' && (` with `{currentOrg?.role === 'admin' && (`.

- [ ] **Step 7: Verify in browser**

1. `npx tsc --noEmit && npx vitest run` pass.
2. Kanban and list views still show all of Kevin's existing leads exactly as before.
3. Add a new lead → confirm via SQL runner it has `org_id` set to Digital Influx Dreamlabs.
4. Admin panel's lead-assignment section still shows unassigned leads correctly.
5. Assignee filter (FilterBar) and the LeadPanel Assignment section still appear for Kevin (admin of his current org).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/003_multi_tenant_foundation.sql src/hooks/useLeads.ts src/components/admin/AssignmentPanel.tsx src/components/pipeline/LeadPanel.tsx src/components/pipeline/FilterBar.tsx
git commit -m "feat: org-scoped RLS cutover - leads + lead_notes"
git push
```

---

### Task 9: RLS cutover — email_templates + email_sequences

**Files:**
- Modify: `supabase/migrations/003_multi_tenant_foundation.sql` (append)
- Modify: `src/hooks/useTemplates.ts`
- Modify: `src/hooks/useSequences.ts`
- Modify: `src/components/emails/TemplateList.tsx`
- Modify: `src/components/emails/SequenceList.tsx`

**Interfaces:**
- Consumes: `is_org_admin`/`is_org_member` (Task 1); `useOrg()` (Task 3).
- Produces: templates/sequences with `org_id = NULL` stay global platform defaults (unchanged from today); templates/sequences with a real `org_id` are private to that org.

- [ ] **Step 1: Append the RLS cutover SQL**

```sql
-- ─────────────────────────────────────────
-- CYCLE 3 PART C (Task 9): email_templates + email_sequences RLS cutover
-- ─────────────────────────────────────────

DROP POLICY "templates_read_all" ON email_templates;
DROP POLICY "templates_own_write" ON email_templates;
DROP POLICY "templates_admin" ON email_templates;
CREATE POLICY "templates_read" ON email_templates FOR SELECT USING (
  org_id IS NULL OR is_org_member(org_id)
);
CREATE POLICY "templates_org_write" ON email_templates FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY "templates_org_update" ON email_templates FOR UPDATE USING (
  (org_id IS NOT NULL AND is_org_member(org_id)) OR (org_id IS NULL AND is_org_admin_of_any())
);
CREATE POLICY "templates_org_delete" ON email_templates FOR DELETE USING (
  org_id IS NOT NULL AND is_org_member(org_id)
);

-- Helper: is the caller an admin of ANY org (needed only for editing the
-- global org_id=NULL default templates/sequences — restricted to admins,
-- not every member of every org, so a random contractor can't edit shared
-- platform defaults).
CREATE OR REPLACE FUNCTION is_org_admin_of_any()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM org_members WHERE user_id = auth.uid() AND role = 'admin')
$$;

DROP POLICY "sequences_read" ON email_sequences;
DROP POLICY "sequences_write" ON email_sequences;
DROP POLICY "sequences_admin" ON email_sequences;
CREATE POLICY "sequences_read" ON email_sequences FOR SELECT USING (
  org_id IS NULL OR is_org_member(org_id)
);
CREATE POLICY "sequences_org_write" ON email_sequences FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY "sequences_org_update" ON email_sequences FOR UPDATE USING (
  (org_id IS NOT NULL AND is_org_member(org_id)) OR (org_id IS NULL AND is_org_admin_of_any())
);
CREATE POLICY "sequences_org_delete" ON email_sequences FOR DELETE USING (
  org_id IS NOT NULL AND is_org_member(org_id)
);
```

Note: `is_org_admin_of_any()` is defined once here (email_templates section) and reused by the `email_sequences` policies below it — don't redefine it a second time.

- [ ] **Step 2: Apply and verify**

Same approach as prior tasks. Verify the 5 seeded templates and 2 seeded sequences (`org_id IS NULL`) are still readable by Kevin via a JWT-authed REST call.

- [ ] **Step 3: Update `src/hooks/useTemplates.ts`**

Add `import { useOrg } from './useOrg';` and `const { currentOrg } = useOrg();`. Change the `refresh` query to include org-scoped rows alongside global defaults:
```ts
  const refresh = useCallback(async () => {
    if (!currentOrg) { setTemplates([]); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('email_templates').select('*')
      .or(`org_id.is.null,org_id.eq.${currentOrg.id}`)
      .order('is_default', { ascending: false }).order('name');
    if (err) setError(err.message);
    else { setTemplates(data as EmailTemplate[]); setError(null); }
    setLoading(false);
  }, [currentOrg]);
```
Change `save`'s insert branch to include `org_id: currentOrg?.id`:
```ts
  const save = useCallback(async (t: TemplateInput, id?: string): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    const { error: err } = id
      ? await supabase.from('email_templates').update(t).eq('id', id)
      : await supabase.from('email_templates').insert({ ...t, template_type: 'custom', created_by: session?.user.id, org_id: currentOrg.id });
    if (err) return err.message;
    await refresh();
    return null;
  }, [refresh, session, currentOrg]);
```

- [ ] **Step 4: Update `src/hooks/useSequences.ts` the same way**

Mirror Step 3's changes exactly, applied to `email_sequences` (table name, `EmailSequence` type, and the `save` function's insert branch — same `org_id: currentOrg.id` addition, same `.or(...)` filter in `refresh`).

- [ ] **Step 5: Update `src/components/emails/TemplateList.tsx`**

Add `import { useOrg } from '../../hooks/useOrg';` and `const { currentOrg } = useOrg();` alongside `const { profile, session } = useAuth();`. Replace both `profile?.role === 'admin'` occurrences (the `canEdit` function and the `isAdmin` prop passed to `TemplateEditor`) with `currentOrg?.role === 'admin'`.

- [ ] **Step 6: Update `src/components/emails/SequenceList.tsx`** the same way (same two replacements, same import).

- [ ] **Step 7: Verify in browser**

1. `npx tsc --noEmit && npx vitest run` pass.
2. `/emails` Templates and Sequences tabs still show the 5 defaults + 2 defaults exactly as before.
3. Create a new custom template → confirm `org_id` set correctly via SQL runner; it appears in the list.
4. Admin-only default-template editing (the `is_default` checkbox) still works for Kevin.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/003_multi_tenant_foundation.sql src/hooks/useTemplates.ts src/hooks/useSequences.ts src/components/emails/TemplateList.tsx src/components/emails/SequenceList.tsx
git commit -m "feat: org-scoped RLS cutover - email_templates + email_sequences"
git push
```

---

### Task 10: RLS cutover — sequence_enrollments, email_logs, scrape_jobs, raw_leads

**Files:**
- Modify: `supabase/migrations/003_multi_tenant_foundation.sql` (append)
- Modify: `supabase/functions/check-sequences/index.ts`
- Modify: `supabase/functions/send-email/index.ts`
- Modify: `src/components/emails/EmailComposer.tsx`
- Modify: `src/hooks/useDrafts.ts`
- Modify: `src/hooks/useEnrollments.ts`
- Modify: `src/components/emails/EmailLogList.tsx`

**Interfaces:**
- Consumes: `is_org_admin`/`is_org_member` (Task 1); `useOrg()` (Task 3); `leads.org_id` (Task 8, already `NOT NULL`).
- Produces: every `email_logs` insert site now sets `org_id` (derived from the lead, since `email_logs.org_id` can't rely on a join — `lead_id` can be `NULL` per its `ON DELETE SET NULL` FK); `scrape_jobs`/`raw_leads` get org-scoped RLS with no client changes (no UI consumes them until Cycle 4).

- [ ] **Step 1: Append the RLS cutover SQL**

```sql
-- ─────────────────────────────────────────
-- CYCLE 3 PART C (Task 10): sequence_enrollments, email_logs, scrape_jobs,
-- raw_leads RLS cutover
-- ─────────────────────────────────────────

DROP POLICY "enrollments_own" ON sequence_enrollments;
DROP POLICY "enrollments_admin" ON sequence_enrollments;
CREATE POLICY "enrollments_org_admin" ON sequence_enrollments FOR ALL USING (
  EXISTS (SELECT 1 FROM leads WHERE id = sequence_enrollments.lead_id AND is_org_admin(leads.org_id))
);
CREATE POLICY "enrollments_own_in_org" ON sequence_enrollments FOR ALL USING (
  EXISTS (SELECT 1 FROM leads WHERE id = sequence_enrollments.lead_id AND is_org_member(leads.org_id))
  AND auth.uid() = enrolled_by
);

ALTER TABLE email_logs ALTER COLUMN org_id SET NOT NULL;
DROP POLICY "logs_own" ON email_logs;
DROP POLICY "logs_admin" ON email_logs;
CREATE POLICY "logs_org_admin" ON email_logs FOR ALL USING (is_org_admin(org_id));
CREATE POLICY "logs_own_in_org" ON email_logs FOR ALL USING (
  is_org_member(org_id) AND auth.uid() = sent_by
);

ALTER TABLE scrape_jobs ALTER COLUMN org_id SET NOT NULL;
DROP POLICY "scrape_jobs_own" ON scrape_jobs;
DROP POLICY "scrape_jobs_admin" ON scrape_jobs;
CREATE POLICY "scrape_jobs_org_admin" ON scrape_jobs FOR ALL USING (is_org_admin(org_id));
CREATE POLICY "scrape_jobs_own_in_org" ON scrape_jobs FOR ALL USING (
  is_org_member(org_id) AND auth.uid() = created_by
);

DROP POLICY "raw_leads_own" ON raw_leads;
DROP POLICY "raw_leads_admin" ON raw_leads;
CREATE POLICY "raw_leads_org_admin" ON raw_leads FOR ALL USING (
  EXISTS (SELECT 1 FROM scrape_jobs WHERE id = raw_leads.scrape_job_id AND is_org_admin(scrape_jobs.org_id))
);
CREATE POLICY "raw_leads_own_in_org" ON raw_leads FOR ALL USING (
  EXISTS (
    SELECT 1 FROM scrape_jobs
    WHERE id = raw_leads.scrape_job_id AND is_org_member(scrape_jobs.org_id) AND scrape_jobs.created_by = auth.uid()
  )
);
```

- [ ] **Step 2: Apply and verify**

Same approach as prior tasks. Verify `email_logs`/`scrape_jobs` row counts unchanged for Kevin via a JWT-authed REST call (no data existed yet in `scrape_jobs`/`raw_leads` at this point — cycle 4 builds their UI — so this step's real risk is `email_logs`, which does have live data).

- [ ] **Step 3: Update `supabase/functions/check-sequences/index.ts`**

The join already fetches `lead:leads(*)`, so `lead.org_id` is available. Add `org_id: lead.org_id` to the `email_logs` insert:
```ts
    const { error: insertErr } = await service.from('email_logs').insert({
      lead_id: lead.id, sequence_enrollment_id: enrollment.id, sent_by: enrollment.enrolled_by,
      to_email: lead.email, subject: finalSubject, body: finalBody, status: 'draft', org_id: lead.org_id,
    });
```

- [ ] **Step 4: Update `supabase/functions/send-email/index.ts`**

`send-email` doesn't currently fetch the lead row at all — it needs to when `lead_id` is present, both to derive `org_id` and to keep the "which org does this log belong to" boundary intact. Add, right after the `settings`/vault-password lookup and before the `log_id` ownership check:
```ts
  let orgId: string | null = null;
  if (body.lead_id) {
    const { data: lead } = await service.from('leads').select('org_id').eq('id', body.lead_id).maybeSingle();
    orgId = (lead as { org_id: string } | null)?.org_id ?? null;
  }
  if (!orgId && !body.log_id) return json({ error: 'lead_id is required to send a new email' }, 400, headers);
```
Then include `org_id: orgId` in the `row` object used for both the insert and update branches — change:
```ts
  const row = {
    lead_id: body.lead_id ?? null, sent_by: user.id, to_email: body.to_email,
    subject: body.subject, body: body.body, status, error_message: errorMessage,
    sent_at: new Date().toISOString(),
  };
```
to:
```ts
  const row: Record<string, unknown> = {
    lead_id: body.lead_id ?? null, sent_by: user.id, to_email: body.to_email,
    subject: body.subject, body: body.body, status, error_message: errorMessage,
    sent_at: new Date().toISOString(),
  };
  if (orgId) row.org_id = orgId; // omitted on update-only calls where org_id is already set on the existing row
```

- [ ] **Step 5: Deploy both functions**

```bash
npx supabase functions deploy check-sequences
npx supabase functions deploy send-email
```

- [ ] **Step 6: Update `src/components/emails/EmailComposer.tsx`**

Add `import { useOrg } from '../../hooks/useOrg';` and `const { currentOrg } = useOrg();`. In the `send(asDraft: boolean)` function's `asDraft` branch, add `org_id: currentOrg?.id` to the insert:
```tsx
      const { error } = await supabase.from('email_logs').insert({
        lead_id: lead.id, to_email: lead.email, subject, body, status: 'draft',
        sent_by: (await supabase.auth.getUser()).data.user?.id,
        org_id: currentOrg?.id,
      });
```

- [ ] **Step 7: Update `src/hooks/useDrafts.ts`**

Add `import { useOrg } from './useOrg';` and `const { currentOrg } = useOrg();`. Add an org filter to the query in `refresh`:
```ts
    const { data } = await supabase
      .from('email_logs')
      .select('*, lead:leads(id, business_name)')
      .in('status', ['draft', 'failed'])
      .eq('org_id', currentOrg?.id ?? '')
      .order('sent_at', { ascending: false });
```
(`currentOrg?.id ?? ''` guards the pre-load moment when `currentOrg` is still `null`; an empty-string filter simply matches nothing until it resolves, which is the same "empty until ready" behavior as the other org-scoped hooks.) Add `currentOrg` to the `useCallback` dependency array.

- [ ] **Step 8: Update `src/hooks/useEnrollments.ts`**

This hook is scoped by `leadId` already (not a broad org-level list), so no query filter is needed — RLS already enforces the boundary correctly via the `leads` join in the policy from Step 1. No code change needed here; this step is a verification-only checkpoint — confirm by reading the file that its query is `eq('lead_id', leadId)`-scoped, not a broad table scan.

- [ ] **Step 9: Update `src/components/emails/EmailLogList.tsx`**

Add `import { useOrg } from '../../hooks/useOrg';` and `const { currentOrg } = useOrg();` wherever the file currently gets `profile` from `useAuth()`. Replace `isAdmin={profile?.role === 'admin'}` with `isAdmin={currentOrg?.role === 'admin'}`.

- [ ] **Step 10: Verify in browser**

1. `npx tsc --noEmit && npx vitest run` pass.
2. Dashboard's "Emails ready to review" queue still shows Kevin's existing drafts.
3. Save a new draft from the composer → confirm `org_id` set via SQL runner.
4. Send a real email (if Kevin's SMTP is configured from cycle 2) → confirm the resulting `email_logs` row has the correct `org_id`.
5. Email Logs tab still works, filters/CSV export unaffected.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/003_multi_tenant_foundation.sql supabase/functions/check-sequences supabase/functions/send-email src/components/emails/EmailComposer.tsx src/hooks/useDrafts.ts src/components/emails/EmailLogList.tsx
git commit -m "feat: org-scoped RLS cutover - sequence_enrollments, email_logs, scrape_jobs, raw_leads"
git push
```

---

### Task 11: RLS cutover — profiles (final), drop legacy role column + is_admin()

**Files:**
- Modify: `supabase/migrations/003_multi_tenant_foundation.sql` (append)
- Modify: `src/hooks/useProfiles.ts`
- Modify: `src/types/index.ts` (remove `role` from `Profile`)
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/ProtectedRoute.tsx`

**Interfaces:**
- Consumes: `is_org_admin`/`is_org_member` (Task 1); `useOrg()` (Task 3).
- Produces: `useProfiles()` now returns org-scoped members shaped `{id, email, full_name, role, created_at}[]` (role = that person's role **within the current org**) — every existing `.filter(p => p.role === ...)` call site across the app (`LeadPanel.tsx`, `PipelineList.tsx`) keeps working unmodified because the shape is preserved, only its source query changes.

- [ ] **Step 1: Append the final RLS cutover SQL**

```sql
-- ─────────────────────────────────────────
-- CYCLE 3 PART C (Task 11, final): profiles RLS cutover + drop legacy
-- global role column and is_admin()
-- ─────────────────────────────────────────

DROP POLICY "profiles_admin_read" ON profiles;
CREATE POLICY "profiles_org_admin_read" ON profiles FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM org_members om1 JOIN org_members om2 ON om1.org_id = om2.org_id
    WHERE om1.user_id = auth.uid() AND om1.role = 'admin' AND om2.user_id = profiles.id
  )
);
-- profiles_self_read and profiles_self_update are unaffected — left as-is.

-- Drop the old global admin() function and (only once nothing references it any more) the column.
DROP FUNCTION is_admin();
ALTER TABLE profiles DROP COLUMN role;
```

- [ ] **Step 2: Before applying — grep-verify nothing still references the old column/function**

```bash
grep -rn "is_admin()" supabase/migrations/ supabase/functions/ || echo "clean"
grep -rn "profile?.role\|profile\.role\|me?\.role\b" src/ || echo "clean"
```
Expected: no matches outside this migration file itself (the `DROP FUNCTION`/`DROP COLUMN` lines are expected hits on `is_admin()`; everything else should say "clean"). If anything else matches, STOP and fix it before proceeding — dropping the column while something still reads it will break that code path immediately.

- [ ] **Step 3: Apply and verify**

Apply just this section. Verify: `select column_name from information_schema.columns where table_name = 'profiles' and column_name = 'role';` returns zero rows; `select proname from pg_proc where proname = 'is_admin';` returns zero rows.

- [ ] **Step 4: Rewrite `src/hooks/useProfiles.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import type { Profile, Role } from '../types';

export type OrgProfile = Profile & { role: Role };

interface MembershipRow { role: Role; profiles: Profile }

/** Members of the current org, each annotated with their role WITHIN that org. */
export function useProfiles() {
  const { currentOrg } = useOrg();
  const [profiles, setProfiles] = useState<OrgProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentOrg) { setProfiles([]); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('org_members').select('role, profiles(*)').eq('org_id', currentOrg.id);
    if (err) setError(err.message);
    else {
      const rows = (data as unknown as MembershipRow[]) ?? [];
      setProfiles(rows.map((r) => ({ ...r.profiles, role: r.role })));
      setError(null);
    }
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profiles, loading, error, refresh };
}
```

- [ ] **Step 5: Update `src/types/index.ts`**

Remove `role: Role;` from the `Profile` interface (it now only has `id, email, full_name, avatar_url, platform_role, created_at, updated_at`). The `OrgProfile` type (Step 4) is what every consumer of `useProfiles()`'s output now uses when a `.role` field is needed.

- [ ] **Step 5b: Fix `LeadPanel.tsx`'s prop type**

This is the one place in the codebase that accesses `.role` on a value typed by its *own declared prop type* rather than on a freshly-narrowed local from `useProfiles()` — so it's the only file where the `Profile.role` removal is a real compile break, not just a downstream consumer. Add `import type { OrgProfile } from '../../hooks/useProfiles';` to `src/components/pipeline/LeadPanel.tsx` and change `LeadPanelProps.profiles: Profile[]` to `profiles: OrgProfile[]` (the `Profile` import can be dropped if nothing else in the file still needs it — check before removing).

- [ ] **Step 6: Update `src/components/layout/Sidebar.tsx`**

Add `import { useOrg } from '../../hooks/useOrg';` and `const { currentOrg } = useOrg();` alongside `const { profile } = useAuth();`. Replace `{profile?.role === 'admin' && (` with `{currentOrg?.role === 'admin' && (`.

- [ ] **Step 7: Update `src/components/layout/ProtectedRoute.tsx`**

Add `import { useOrg } from '../../hooks/useOrg';` inside `AdminRoute`. Replace:
```tsx
export function AdminRoute() {
  const { profile, loading } = useAuth();
  if (loading) return null;
  if (profile?.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
```
with:
```tsx
export function AdminRoute() {
  const { loading: authLoading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  if (authLoading || orgLoading) return null;
  if (currentOrg?.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
```

- [ ] **Step 8: Full-app typecheck and test**

```bash
npx tsc --noEmit
npx vitest run
```
This is the point where any remaining stale `.role` reference on the old `Profile` shape will surface as a type error — fix any that appear (there shouldn't be any given Steps 5–7 and the earlier tasks' migrations, but this is the safety net).

- [ ] **Step 9: Full-app browser verification**

Walk through the entire app as Kevin: Dashboard, Pipeline (Kanban + List), a lead's detail page (Assignment section, contractor filter), Emails hub (Templates/Sequences/Logs, admin-only default editing), Settings (Email + Organization pages), Admin panel (member management, invite, new-org). Everything should look and behave exactly as it did before Cycle 3 started, plus the new org switcher (once Kevin has ≥2 memberships) and organization settings page.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/003_multi_tenant_foundation.sql src/hooks/useProfiles.ts src/types/index.ts src/components/layout/Sidebar.tsx src/components/layout/ProtectedRoute.tsx
git commit -m "feat: org-scoped RLS cutover - profiles (final), drop legacy global role + is_admin()"
git push
```

**Phase B complete.** Every table is org-scoped, no legacy global-role code path remains anywhere in the app.

---

### Task 12: Full multi-tenant RLS audit + docs

**Files:**
- Modify: `CLAUDE.md` (Current Status)
- Modify: `docs/AUTOMATIONS.md` (note the org-scoping of AI/scraper key resolution)

- [ ] **Step 1: Full automated pass**

`npx vitest run && npx tsc --noEmit && npm run build` — all green.

- [ ] **Step 2: Multi-org RLS + security audit (script)**

Extend the cycle-1/2 throwaway-user pattern to **two separate orgs**: create two throwaway users via the service role, add one to a new throwaway org "RLS Audit Org A" and the other to "RLS Audit Org B" (both created via the `create_org` action or direct service-role inserts), then verify via REST as each user:

1. User A cannot read User B's org's leads/notes/templates/sequences/logs/enrollments (0 rows on every table).
2. User A (made org-admin of Org A) cannot manage Org B's members via `admin-users` (`set_org_role`/`invite`/`list_org_members` targeting Org B's id all return 403).
3. A non-platform-admin user's `create_org` call is rejected (403).
4. `org_api_settings`/Vault keys for Org A are unreadable to User B (both via direct REST select on `org_api_settings` for another org's id, and via the `org-api-settings` edge function).
5. The API-key global fallback never applies to a non-Kevin-owned org: create a throwaway org with `use_global_api_fallback = false` (the default), confirm `generate-email`/`parse-notes` return `ai_used:false`/`suggestion:null` for a lead in that org even though the global `GEMINI_API_KEY` secret exists.
6. Kevin (platform admin) retains full cross-org visibility via `list_orgs`/`list_org_members`.
7. Clean up: delete both throwaway orgs, their members, and the throwaway users.

Expected: every check PASS; record the PASS/FAIL table in the task report.

- [ ] **Step 3: Update docs**

`CLAUDE.md` Current Status: add multi-tenancy (organizations, org-scoped RLS, org-level BYO API keys, Google Sign-In) to Working; note the 4 seeded orgs and that Kevin's own two (Digital Influx Dreamlabs, Mr Brush & Co) use the global API-key fallback while the other two require their own keys. Known issues: note that `email_templates`/`email_sequences` with `org_id = NULL` (the platform defaults) can only be edited by an admin of *any* org (`is_org_admin_of_any()`), not scoped per-org — acceptable for now since there's only one shared default set, worth revisiting if orgs ever need their own default sets.

`docs/AUTOMATIONS.md`: update the `generate-email`/`parse-notes`/`check-sequences` rows to note they now resolve the calling org's own API key (with Kevin's-orgs-only global fallback) rather than always using the global secret.

- [ ] **Step 4: Commit + push**

```bash
git add CLAUDE.md docs/AUTOMATIONS.md
git commit -m "chore: cycle 3 complete - multi-tenant foundation live"
git push
```

---

## Self-Review Notes (applied)

- **Spec coverage:** organizations/org_members/platform_role (T1–2), org-scoped RLS for all 9 pre-existing tables (T8–11), org-level API keys with Kevin's-orgs-only fallback (T5), Google Sign-In with invite-only guardrail (T6), org-scoped admin-users + admin panel + new-org bootstrapping (T4, T7), org switcher (T3), full audit (T12). Human step flagged: Google Cloud OAuth client (T6).
- **Safety sequencing:** Phase A (T1–7) is purely additive and independently verified after every task to leave the live app unchanged; Phase B (T8–11) is the only phase that touches existing RLS policies, ordered one table-family at a time so a problem in one task doesn't block review of the others in flight.
- **Consistency:** `is_org_admin(org_id)`/`is_org_member(org_id)` defined once (T1), reused by every subsequent policy; `useOrg()` defined once (T3), consumed identically everywhere; the `Role` type (`'admin'|'contractor'`) is reused for `org_members.role` rather than introducing a parallel type; `OrgProfile = Profile & {role}` (T11) preserves the exact shape existing `.filter(p => p.role === ...)` call sites expect (`PipelineList.tsx`) — verified by grep that only `LeadPanel.tsx` accesses `.role` on its *own declared prop type* rather than a freshly-narrowed local, so it's the one file whose prop type (`Profile[]` → `OrgProfile[]`) must change alongside the `Profile.role` removal (T11 Step 5b); everything else is structurally compatible without modification.
- **Known deliberate simplification:** default (`org_id = NULL`) templates/sequences are editable by any org's admin, not scoped to a specific "platform admin" concept for content — acceptable since there's currently one shared default set for all orgs; documented in Task 12.
