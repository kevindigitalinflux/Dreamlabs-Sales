# Usage and quotas (sub-project A of 3) — Design

Date: 2026-10-14. Status: written, awaiting Kevin's review. Nothing built.

Part of the lookup-worker programme (`docs/LOOKUP-TOOLS-PLAN.md`, `docs/superpowers/plans/2026-10-14-lookup-worker-phase1-infra.md`).
Order: **A. Usage and quotas** (this spec) -> B. Background jobs tracker and notification bar -> C. Worker integration into Deep find, Fill in missing details and Find decision maker.

## Why
The self-hosted worker (`https://lookup.didreamlabs.com`) is shared by all organisations on one 2 vCPU / 8 GB VPS that also runs n8n. It cannot tell organisations apart, so the app must meter and cap use itself, with a **hard** worker-wide ceiling that can never be exceeded, and show people what is left and when it resets.

## Understanding Kevin confirmed
- Per-organisation daily caps and a hard worker-wide cap (100 / 400 site scrapes, 150 / 300 email checks, 300 / 1,000 page fetches).
- A usage meter in the top bar, right next to the light/dark toggle. It shows the allowance **closest to running out**; hovering lists every allowance with a plain reset time. Chosen design: chip + hover list (also opens on keyboard focus and tap).
- Nothing credit-based is shared: Hunter/Apollo/Firecrawl stay bring-your-own-key per organisation (existing rule).

## Scope
In: usage tables and atomic reserve/refund functions, default limits, admin editing of per-org limits, the meter, a provider-allowance read for Hunter, tests, docs.
Out (later or never): the jobs tracker and notification bar (B); calling the worker from any feature (C); AI token counts (Gemini/Claude report no remaining quota; add plain usage counting later, no cap); Firecrawl allowance (arrives with its provider); per-organisation tokens inside the worker (only needed for an outside organisation, see CLAUDE.md runbook).

## Resources and defaults
| resource | label | per-org default / day | worker-wide / day |
|---|---|---|---|
| `worker_scrape` | Site scrapes (a `deep` scrape costs 3 units) | 100 | 400 |
| `worker_verify` | Email checks | 150 | 300 |
| `worker_fetch` | Page fetches | 300 | 1,000 |
- An outside organisation (future) starts at 20 / day for each resource; set explicitly when it is added.
- Cache hits cost nothing (no reserve is made). A call that fails because the worker is unreachable, busy or not configured gives its units back; a scrape that ran and found nothing does not.
- **Shared pool:** worker-wide caps bind first for email checks (4 x 150 > 300), so one busy organisation can use the pool up. That is accepted for now (all four organisations are Kevin's); the meter says "Shared worker allowance used up today" (distinct from "Your organisation's limit reached") so it is never confusing. No per-org share is added (YAGNI).
- Days reset at **00:00 Europe/London**, shown as "resets at 00:00 (in 6h 12m)".

## Data (migration `059_usage_quotas.sql`)
- `usage_resources(resource PK, label, unit_label, default_org_limit, global_limit)` — seeded, service-role writes only.
- `usage_limits(org_id, resource, daily_limit CHECK 0..5000, updated_by, updated_at, PK(org_id, resource))` — per-org overrides.
- `usage_counters(org_id, resource, day DATE, used INT CHECK >= 0, PK(org_id, resource, day))` and `usage_global_counters(resource, day, used, PK(resource, day))`.
- RLS: SELECT on `usage_limits` and `usage_counters` for `is_org_member(org_id)`; `usage_limits` INSERT/UPDATE for `is_org_admin(org_id)` with `updated_by = auth.uid()` forced by a trigger; no client INSERT/UPDATE/DELETE on counters or global tables; `usage_resources` readable by authenticated users.
- Functions, `SECURITY DEFINER`, `SET search_path = ''`, granted to `service_role` only:
  - `usage_reserve(p_org, p_resource, p_units 1..10) -> jsonb {ok, reason: null|'org_limit'|'shared_pool'|'bad_input', day, used, limit, global_used, global_limit}`. One transaction: lock the global row, then the org row (fixed order, no deadlocks), check both, update both. Two simultaneous reserves can never overshoot either cap.
  - `usage_refund(p_org, p_resource, p_units, p_day)` — decrements both, floors at 0, only for the day originally reserved.
- `usage_snapshot(p_org) -> jsonb` — `SECURITY DEFINER` but starts with an `is_org_member` check; returns, per resource, `{used, limit, shared_pool_left, resets_at}` for the meter. Granted to `authenticated`.
- Counters are tiny (about 3 resources x 4 organisations x 365 rows a year), so no purge job.

## Server code
- `supabase/functions/_shared/usage.ts` (Deno): `reserveUsage(service, orgId, resource, units)`, `refundUsage(...)`, plain-English refusal text per reason. **Fails closed**: any RPC error is "not allowed", like Deep find and the known-person lookup.
- Hunter allowance for the meter comes from the existing Hunter account read (`hunterLimits.ts` / the `hunter_account` action), cached per organisation for 10 minutes in `usage_provider_cache(org_id, provider, data jsonb, fetched_at)` (service writes, members read). Shown only when the organisation has a Hunter key. The meter fetches it on open, not on a timer.

## Client
- `src/lib/usage.ts` (pure, tested): `tightestAllowance`, `usageState` (ok < 80% used, `warning` 80% to < 100%, `full` at the cap or shared pool used up), `formatResetsIn`, resource labels.
- `src/hooks/useUsage.ts`: snapshot via RPC, refetch every 60 s and on realtime changes to `usage_counters`; **per-instance channel name via `useId()`** (CLAUDE.md rule).
- `src/components/layout/UsageMeter.tsx` in `TopBar`, between `ThemeToggle` and `OrgSwitcher`: chip text always states the situation in words ("Email checks: 40 left", "Email checks: limit reached"), colour only reinforces (amber/red tokens from the theme, contrast checked); popover opens on hover, focus and tap, closes with Escape, `aria-expanded`/`aria-live="polite"` only on state change; list rows show `used / limit`, period and reset ("resets at 00:00 (in 6h 12m)", "renews 18 Oct" for Hunter). Hidden for users with no worker access.
- Settings -> "Usage limits" card (admin only): per-resource limit inputs saved on blur (existing inline-edit pattern), shows today's use, "Reset to default".

## Error handling
- Quota check errors, or reservation refused: the feature skips the worker step and falls back to the current free steps, with one fixed line (no raw errors) such as "Extra lookup skipped: your organisation has used its 150 email checks for today (resets at 00:00)".
- The meter itself failing to load shows nothing alarming: chip reads "Usage unavailable" and logs to the console.

## Security
- Browser can read its organisation's usage but cannot write counters or global rows; reserve/refund are service-role only; `usage_snapshot` checks membership. Limits editable only by organisation admins and capped at 5000.
- No secrets involved; the worker secret stays in function secrets.
- Documentation: add the resources and caps to `docs/AUTOMATIONS.md` and CLAUDE.md.

## Testing
- Pure unit tests (vitest): thresholds, tightest allowance, reset-time maths across the BST/GMT change.
- SQL tests against the real project in a scratch org: limits respected, global ceiling respected, refund floors at 0 and only for the same day, **concurrency test** (many parallel reserves of 1 unit against a limit of N never produce more than N successes), refused calls leave counters unchanged.
- RLS audit (same method as cycles 2 and 3, throwaway users via SQL, full cleanup): member can read own org only, cannot write counters/global/resources, non-admin cannot edit limits, admin can edit own org only, `usage_snapshot` refuses other organisations.
- Browser check of the meter on desktop and 400 px width: states, keyboard, Escape, reduced motion, dark and light themes; contrast check of the three states.

## Success criteria
1. No sequence of calls, however concurrent, can exceed an organisation limit or a worker-wide cap.
2. The meter always tells a person, in words, what is left and when it resets.
3. If the quota check breaks, nothing reaches the worker and the feature still works with its existing steps.

## Assumptions to confirm
- Reset at 00:00 Europe/London for all organisations (UX Tree's Ireland/US users see UK midnight; per-organisation time zones can follow later).
- Admins of an organisation may raise their own limits up to 5000, but never past the worker-wide cap (the cap always wins). If you prefer only platform admins to change limits, say so.
