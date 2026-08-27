# Cycle 3 — Multi-Tenant Foundation — Design

**Date:** 2026-08-27 · **Status:** Approved by Kevin (roadmap + all decisions confirmed in session)

## Context

Dreamlabs Sales was built (cycles 1–2) as a single-tenant internal tool for Digital Influx
Dreamlabs. Kevin now needs it to serve multiple separate organizations — his own second
company (Mr Brush & Co), a sister company he doesn't own (Digital Influx, owned by Suj), and
at least one external partner (UX Tree) — each with fully isolated data, their own team
members, and (critically) their own third-party API keys so Kevin never pays for another
org's AI/scraping usage. This is free/partner access, not a paid product — no billing/plans
to design.

This cycle is purely foundational: organizations, membership, org-scoped RLS across every
existing table, org-level API key storage, Google Sign-In, and the invite/admin-panel changes
needed to operate it. It unblocks Cycle 4 (lead scraper, now built against org-scoped keys)
and Cycle 5 (cold-outreach automation). No new user-facing features ship this cycle beyond
"multiple isolated workspaces exist and can be managed."

## Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Tenancy model | One shared app/DB, org-scoped via RLS (not separate deployments per company) |
| Digital Influx vs Digital Influx Dreamlabs | Separate entities — Digital Influx Dreamlabs (Kevin's) and Digital Influx (Suj's, sister company) each get their own org |
| Initial orgs to seed | Digital Influx Dreamlabs, Mr Brush & Co, Digital Influx, UX Tree |
| Monetization | None — free/partner access, no billing/plans in scope |
| "Google-connects-to-their-API" mechanism | Two separate things: (1) Google Sign-In as a login method, (2) each org configures its own API keys in an org settings page (same Vault pattern as cycle 2's SMTP settings, generalized) |
| API key fallback | Kevin's own orgs (DI Dreamlabs, Mr Brush) fall back to his existing global keys if unconfigured. Every other org must configure its own before AI/scraper features activate — this is the actual mechanism that guarantees Kevin never pays for their usage |
| Build approach | Fable orchestrates; Sonnet implements well-specified tasks; Opus used for planning anything still under-specified (per Kevin's standing preference) |

## 1. Data model

### New tables

```sql
CREATE TABLE organizations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE org_members (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id     UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT DEFAULT 'contractor' CHECK (role IN ('admin','contractor')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE org_api_settings (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       UUID REFERENCES organizations(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('gemini','google_places','companies_house')),
  is_configured BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, provider)
);
-- Actual key values live in Supabase Vault under secret name
-- 'org_api_key_<org_id>_<provider>', written only via a SECURITY DEFINER
-- helper (app_set_org_api_key/app_get_org_api_key), same pattern as the
-- existing app_set_smtp_secret/app_get_smtp_secret from cycle 2.
```

### `profiles.role` is repurposed to a platform role

Today `profiles.role` (`admin`/`contractor`) is the *only* role concept and is checked
globally everywhere via `is_admin()`. Under multi-tenancy this column is renamed
`platform_role` with values `platform_admin`/`user`. **Only Kevin holds `platform_admin`** —
it is what lets someone create a brand-new organization and seed its first admin. All
day-to-day admin/contractor behavior (who sees every lead in an org vs only their own, who
manages that org's templates/sequences/settings/members) moves to `org_members.role`,
checked per-org via a new `is_org_admin(org_id)` helper:

```sql
ALTER TABLE profiles RENAME COLUMN role TO platform_role;
ALTER TABLE profiles ALTER COLUMN platform_role SET DEFAULT 'user';
-- (drop the old admin/contractor CHECK, add platform_admin/user CHECK)
UPDATE profiles SET platform_role = 'platform_admin' WHERE email = 'kevindigitalinflux@gmail.com';
UPDATE profiles SET platform_role = 'user' WHERE platform_role <> 'platform_admin';

CREATE OR REPLACE FUNCTION is_org_admin(target_org UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM org_members WHERE org_id = target_org AND user_id = auth.uid() AND role = 'admin')
$$;

CREATE OR REPLACE FUNCTION is_org_member(target_org UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM org_members WHERE org_id = target_org AND user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND platform_role = 'platform_admin')
$$;
```

The old `is_admin()` function is dropped once every policy referencing it is migrated.

### `org_id` retrofit across existing tables

| Table | Change | Why |
|---|---|---|
| `leads` | add `org_id UUID NOT NULL REFERENCES organizations(id)` | owns org-scoped data directly |
| `scrape_jobs` | add `org_id` (NOT NULL) | same |
| `email_logs` | add `org_id` (NOT NULL) | `lead_id` can be `NULL` (`ON DELETE SET NULL`), so org can't always be derived via join — store it directly, set at insert time |
| `email_templates` | add `org_id` (**nullable**) | `NULL` = platform default (today's 5 seeded templates stay exactly as-is, globally readable); a real org_id = that org's private custom template |
| `email_sequences` | add `org_id` (**nullable**) | same pattern — the 2 seeded defaults stay `org_id = NULL` |
| `lead_notes` | **no new column** | derives org via `lead_id → leads.org_id` join in its RLS policy |
| `sequence_enrollments` | **no new column** | derives via `lead_id → leads.org_id` |
| `raw_leads` | **no new column** | derives via `scrape_job_id → scrape_jobs.org_id` (mirrors its existing `raw_leads_own` policy shape, which already joins through `scrape_jobs`) |
| `user_email_settings` | **unchanged** | personal SMTP credentials are per-person, not an org resource |

Every existing admin-scoped policy (`leads_admin`, `notes_admin`, `templates_admin`,
`sequences_admin`, `enrollments_admin`, `logs_admin`, `scrape_jobs_admin`, `raw_leads_admin`,
`profiles_admin_read`) is rewritten from `USING (is_admin())` to `USING (is_org_admin(<row's org_id, via column or join>))`.
Worked example (`leads`, replacing both existing policies):

```sql
ALTER TABLE leads ADD COLUMN org_id UUID REFERENCES organizations(id);
-- backfill (see §5), then:
ALTER TABLE leads ALTER COLUMN org_id SET NOT NULL;

DROP POLICY "leads_own" ON leads;
DROP POLICY "leads_admin" ON leads;
CREATE POLICY "leads_org_admin" ON leads FOR ALL USING (is_org_admin(org_id));
CREATE POLICY "leads_own_in_org" ON leads FOR ALL USING (
  is_org_member(org_id) AND (auth.uid() = created_by OR auth.uid() = assigned_to)
);
```

`profiles_admin_read` becomes a join-based "can I see profiles of people I share an
admin'd org with":

```sql
DROP POLICY "profiles_admin_read" ON profiles;
CREATE POLICY "profiles_org_admin_read" ON profiles FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM org_members om1 JOIN org_members om2 ON om1.org_id = om2.org_id
    WHERE om1.user_id = auth.uid() AND om1.role = 'admin' AND om2.user_id = profiles.id
  )
);
```

The full policy-by-policy rewrite for all remaining tables follows this same pattern; the
implementation plan enumerates each one exactly.

## 2. Org-level API keys

`org_api_settings` + Vault helpers `app_set_org_api_key(org_id, provider, secret)` /
`app_get_org_api_key(org_id, provider)` (SECURITY DEFINER, service-role only — identical
shape to the existing SMTP helpers). A new `/settings/organization` page (org-admin only)
lists the three providers (Gemini, Google Places, Companies House) with a key input + save
per provider, mirroring `/settings/email`'s UX.

`organizations` gets one more column: `use_global_api_fallback BOOLEAN DEFAULT false`,
settable only by a platform admin (never by an org's own admin — an org can't grant itself
permission to spend Kevin's API budget). Set `true` only for Digital Influx Dreamlabs and Mr
Brush & Co during the migration in §6; every other org (including future ones) defaults to
`false`.

**Resolution order in every edge function that calls these APIs** (`_shared/ai.ts`'s
`draftEmail`/`parseNotes`, and the not-yet-built scraper functions): look up
`org_api_settings` for the calling org; if configured, use that org's Vault key; if not
configured **and** `organizations.use_global_api_fallback = true` for that org, fall back to
the existing global environment secret; otherwise fail with a clear "this organization needs
to configure its own \<provider\> key" error (never silently uses Kevin's key for someone
else's org).

## 3. Auth — Google Sign-In

Added as a second login method on `/login` alongside email/password. Requires a Google Cloud
OAuth client (**human step**: Kevin creates it in Google Cloud Console, adds the Supabase
callback URL as an authorized redirect, pastes client ID/secret into Supabase Auth provider
settings).

**Guardrail (must hold regardless of Supabase's exact default OAuth behavior, which the plan
verifies against the live project rather than assuming): Google Sign-In must only ever
authenticate someone who already has an invited `profiles` row with at least one
`org_members` membership.** Concretely: after the OAuth callback returns a session, the app
checks whether that user has any `org_members` row; if not, it's an uninvited sign-in attempt
— immediately sign them out client-side and show "This Google account hasn't been invited to
Dreamlabs Sales." This check is redundant with (not a replacement for) configuring Supabase
Auth to require pre-existing users where possible — the point is the app never renders any
authenticated view for a zero-membership account, so even if Supabase's OAuth config allowed
account creation, an uninvited signer gets nothing.

## 4. Org selection (client)

RLS is the actual security boundary — a query can never return another org's rows no matter
what the client does. On top of that, the app tracks a **currently selected org** (persisted
similarly to the existing `pipeline-view`/`focus-mode` localStorage pattern) and every list
query additionally filters `WHERE org_id = <selected>`, so a user in two orgs never sees them
blended in one view. A new org-switcher in the top bar appears whenever `useOrg()` reports
more than one membership; single-org users see no switcher at all (Kevin's the only person
this cycle who's in more than one org).

This requires a new `OrgProvider`/`useOrg()` context (parallel to the existing `AuthProvider`)
exposing `{ currentOrg, currentOrgRole, orgs, switchOrg }`. Every existing client-side
`profile?.role === 'admin'` check across the codebase (Sidebar nav, `AdminRoute`, `LeadPanel`
assignment section, `FilterBar` assignee filter, `TemplateEditor`/`SequenceBuilder`
is_default checkboxes, `Admin.tsx`) is migrated to `currentOrgRole === 'admin'`. The
implementation plan greps and enumerates every call site precisely — this design names the
pattern and the known hotspots, not an exhaustive file list.

## 5. Invite flow & admin panel

`admin-users` edge function changes:
- `invite` action gains required `org_id` + `org_role` params. Caller must be
  `is_platform_admin()` **or** `is_org_admin(org_id)`. After `inviteUserByEmail` succeeds
  (which synchronously creates the `auth.users` row, firing the existing `handle_new_user`
  trigger), the function inserts the matching `org_members` row in the same call.
- The existing "set role" action becomes org-scoped: updates `org_members.role` for a given
  `(org_id, user_id)`, gated the same way (platform admin or that org's admin).
- New `create_org` action: `is_platform_admin()`-only, inserts an `organizations` row and
  returns its id; the platform admin then uses the (now org-scoped) `invite` action to seed
  that org's first admin.

`Admin.tsx` gains: an org selector (platform admin sees all orgs; an org-admin who isn't
platform admin sees only their own org, no selector shown), a "New organization" action
(platform-admin only), and the invite form now includes an org-role picker scoped to the
selected org.

## 6. Migration for existing production data

One-time, run once, tested thoroughly before executing against real data:
1. Insert the `organizations` row for "Digital Influx Dreamlabs".
2. Backfill `org_id` on every existing row in `leads`, `scrape_jobs`, `email_logs` to that
   org's id, plus on any **non-default** (`is_default = false`) existing rows in
   `email_templates`/`email_sequences` (the seeded defaults stay `org_id = NULL` and need no
   change).
3. Insert `org_members` rows for Kevin and every existing profile, preserving their current
   `role` value as their `org_members.role` in that org.
4. Only then apply the `NOT NULL` constraints and the new RLS policies.
5. Insert the remaining three seed orgs (Mr Brush & Co, Digital Influx, UX Tree) — empty,
   ready for their first invited admin.

## 7. Testing

RLS audit extended beyond cycle 1/2's single-tenant checks: two throwaway users in two
different orgs, verifying zero cross-org visibility on every table (including the
`lead_notes`/`sequence_enrollments`/`raw_leads` join-derived cases, which are easy to get
subtly wrong), org-admin scope boundaries (can't manage another org's members even as that
org's own admin), platform-admin-only actions correctly rejected for org-admins, and the
API-key fallback logic never resolving Kevin's key for a non-Kevin org. Existing Kevin data
(real leads, templates, logs) spot-checked post-migration to confirm nothing changed from his
point of view.

## Out of scope (deferred to later cycles)

Billing/plans, self-serve org signup, per-org branding/white-labeling, the lead scraper
itself (Cycle 4), cold-outreach automation (Cycle 5), automated cold calling (backlog).
