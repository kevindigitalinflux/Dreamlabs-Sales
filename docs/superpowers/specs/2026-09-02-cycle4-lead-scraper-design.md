# Cycle 4 — Lead Scraper — Design

## Context

Dreamlabs Sales has run its pipeline, dashboard, and email automation single- and now
multi-tenant since cycles 1-3. The one module speced from the start but never built is the
lead scraper (`SPEC.md` §4-5): an ICP-driven prospect-finder that turns a free-text business
description into a scored, reviewable list of candidate leads, sourced from Google Places and
(UK) Companies House, which the user approves into the pipeline.

`SPEC.md` §5 already contains a detailed, still-valid UX flow — this design keeps it as the
baseline and layers on what's changed since it was written: the app is now multi-tenant
(`scrape_jobs`/`raw_leads` already carry `org_id` with org-scoped RLS from cycle 3, unused
until now), the org-level BYO-API-key pattern exists (`org_api_settings` + `resolveOrgApiKey()`),
and the two orgs actually shipping this — Mr Brush & Co (UK) and DI Dreamlabs (US-primary,
UK-secondary) — need both UK and US discovery, not just UK as originally speced.

## Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Org scope for this build | Mr Brush & Co + DI Dreamlabs first; architecture fully org-scoped so UX Tree/DI Academy work the moment they configure their own keys (self-service already built in `OrganizationSettings.tsx`) |
| Base UX flow | Keep `SPEC.md` §5 as written (ICP text → AI parse → confirm → pick sources → scrape → review/approve), modernised for org-scoping and `gemini-3.6-flash` |
| Email discovery | Keep it — best-effort website `mailto:`/contact-page scrape per result, blank on failure |
| Execution model | Background processing via Deno `EdgeRuntime.waitUntil()` — the job row is created and the function returns immediately, then keeps working; UI tracks progress via realtime subscription on `scrape_jobs.status`, per `SPEC.md`'s original design |
| Discovery sources | Google Places (UK **and** US — it's a global API, same data quality either way) + Companies House (UK-only registry supplement, checkbox auto-hides for non-UK ICPs) |
| US registry equivalent | None — researched (2026-09-02): Apollo/Hunter free tiers have **no API access** at any price point below their paid tiers; OpenCorporates' free API key is restricted to non-commercial (journalist/NGO) use; SAM.gov is free + commercial-legal but only covers federal contractors, not general SMEs. No free source adds real discovery value for a general US SME ICP — decided not to force one in. |
| Apollo / Hunter | Optional, fully wired, **paid, BYO-key, per-lead, opt-in** enrichment actions in the review table — not discovery sources, not automatic, never covered by Kevin's global-fallback mechanism (that stays Gemini/Places/Companies-House only) |
| Out of scope | SAM.gov, any country beyond UK/US, bulk/automatic enrichment |

---

## 1. Sources

### Google Places — primary discovery, UK + US
Unchanged in shape from `SPEC.md` §4's `scrape-google-places`: ICP-derived Text Search query,
paginated up to 60 results, `name`/`formatted_phone_number`/`website`/`formatted_address`/
`rating`/`user_ratings_total`/`place_id` per result, best-effort email via website scrape. The
only change from the original spec is that the ICP's parsed `location` drives Google's region
biasing directly — no UK-only assumption anywhere in the query construction.

### Companies House — UK-only supplement
Unchanged from `SPEC.md` §4's `scrape-companies-house`. The source-picker checkbox is disabled
(not just unchecked) whenever the parsed ICP's country isn't UK, with a short inline note why —
prevents a confusing "why did this return nothing" for a US-targeted search.

### Apollo / Hunter — optional paid per-lead enrichment (not discovery)
Two new BYO-key providers, surfaced two ways:
1. **Settings:** `OrganizationSettings.tsx` gets two more provider rows, reusing the existing
   `ProviderGuide` component exactly like Gemini/Places/Companies House — button to the
   provider's own signup/key page, plain-English framing (**explicitly stating these are paid,
   billed to the org's own account, unlike the other three**), no numbered mini-guide needed
   (their own signup flows are already simple).
2. **Review table:** each `raw_leads` row gets two conditional buttons — "Enrich with Apollo"
   and "Find email with Hunter" — that render only when `org_api_settings.is_configured` is
   true for that provider (same check the AI-drafting/scraper features already use to decide
   whether a feature is "on" for an org). Clicking one calls a small enrichment edge function
   for that single lead only; nothing runs in bulk or automatically.

Ruled out as *discovery* sources for either country (see decision table): SAM.gov, state
Secretary-of-State registries, OpenCorporates free tier.

---

## 2. Data model

Minimal — cycle 3 already did the multi-tenant groundwork for these tables.

**`org_api_settings.provider` CHECK constraint** extends from
`CHECK (provider IN ('gemini','google_places','companies_house'))` to add `'apollo'` and
`'hunter'`. `supabase/functions/_shared/orgApiKeys.ts`'s `ApiProvider` union type gets the same
two additions. `GLOBAL_ENV_VARS` (the map `resolveOrgApiKey()` uses for Kevin's-orgs-only
fallback) does **not** get entries for `apollo`/`hunter` mapped to real secrets — either omit
them (requires a small type change: `GLOBAL_ENV_VARS` becomes `Partial<Record<ApiProvider, string>>`
and the lookup treats a missing entry as no-fallback-available) or map them to intentionally
unset env var names. Either way the effect is identical and intentional: `resolveOrgApiKey()`
returns `null` for `apollo`/`hunter` unless the org configured its own key — full stop, no
fallback path exists for these two regardless of `use_global_api_fallback`.

**`raw_leads`** — no new columns. Enrichment success updates the existing `email`/`owner_name`/
`phone` fields in place (only overwriting a field if the enrichment call actually returned a
better value — never blanking an existing value on a partial/failed response), and the full
provider response is stashed under a new key in the existing `raw_data JSONB` column (e.g.
`raw_data.enrichment.apollo`), giving a debuggable audit trail without new schema.

**`scrape_jobs`/`raw_leads` RLS and `org_id`** — already correct as of cycle 3 Task 10
(`org_id NOT NULL` on `scrape_jobs`, org-scoped policies on both tables). Nothing to migrate.

---

## 3. Edge functions

| Function | Trigger | Notes |
|---|---|---|
| `parse-icp` | User submits ICP free text | Gemini call via `resolveOrgApiKey()` (org's key, Kevin's-orgs fallback applies). Country-aware: the structured output includes a `country` field (`'GB'`/`'US'`/other) the frontend uses to drive Companies House's checkbox and Google Places' region bias. |
| `scrape-google-places` | User confirms sources + hits scrape | Creates the `scrape_jobs` row (`status='pending'`), responds immediately, then does the real work inside `EdgeRuntime.waitUntil()`: paginated Places search → per-result website fetch for email (bounded concurrency + short per-site timeout so one slow/hostile site can't stall the whole job) → duplicate-flagging against the org's existing `leads`/pending `raw_leads` → writes to `raw_leads` → flips `scrape_jobs.status` to `completed`/`failed`. **Hard constraint (verified 2026-09-02): Supabase background tasks are capped at 150s wall-clock on the Free plan** (this project's current plan — see `CLAUDE.md`'s Supabase account map — 400s on paid). The concurrency bound on website fetches must be sized to comfortably clear 60 results within that ceiling even in a worst-case-timeout scenario (e.g. concurrency ~8-10 with a ~5s per-site timeout keeps the worst case around 30-40s) — this isn't just about one slow site blocking others, it's a hard platform limit the job must finish inside. |
| `scrape-companies-house` | Same trigger, if the checkbox was on | Same job/background shape, writes `raw_leads` with `source='companies_house'`. |
| `enrich-apollo` | Row-level "Enrich with Apollo" click | Synchronous, single lead. Resolves the org's Apollo key (no fallback per above), calls Apollo, updates the one `raw_leads` row. |
| `enrich-hunter` | Row-level "Find email with Hunter" click | Same shape as `enrich-apollo`, Hunter's domain-search/email-finder endpoint. |

All five follow the existing repo convention: caller-JWT client for RLS-scoped reads, service-role
client for the actual scraper/enrichment writes, `resolveOrgApiKey()` for every third-party call.

---

## 4. Frontend flow

Follows `SPEC.md` §5 exactly for the wizard shape (`/scraper` 4-step ICP wizard →
`/scraper/jobs/:id` review table), with these additions:
- Every query/mutation is `useOrg()`-scoped, matching every other cycle-3 hook.
- Companies House checkbox disables (not hides — a disabled control with a one-line "UK only"
  note teaches the constraint) when `parse-icp`'s returned `country !== 'GB'`.
- Real-time progress: Supabase Realtime subscription on the job's `scrape_jobs` row, as
  originally speced — the background `waitUntil` work updates `status`/`results_count` as it
  progresses, the UI reflects it live without polling.
- Review table gains the two conditional enrichment buttons (§1), each showing a small inline
  cost-awareness label (e.g. "uses 1 Apollo credit") next to the button — not a blocking
  confirm dialog, matching the low-friction feel of the existing "Personalise with AI" action,
  just honest that this one isn't free.

---

## 5. Duplicate detection

Org-scoped, per `SPEC.md` §5: a `raw_leads` row is flagged (amber, "Possible duplicate" badge)
if `business_name`+`city` or `email` matches any existing `leads` row **or** any other pending
`raw_leads` row **within the same org** — cross-org matches are never considered (RLS would
prevent seeing them anyway, but the query is written org-scoped explicitly, not relying on RLS
alone for this specific comparison logic, since it runs service-role inside the edge function).

---

## 6. Testing

- Unit tests for the ICP-country-detection → Companies House checkbox gating logic, and for the
  org-scoped duplicate-matching logic (both pure-enough functions to unit test without a live DB).
- Live verification (matching the cycle-3 controller-verification pattern): a real scrape job
  end-to-end for Mr Brush & Co (UK ICP) and one for DI Dreamlabs (US ICP), confirming
  `org_id` correctness throughout, realtime status updates land in the browser, and the
  Companies House checkbox correctly disables for the US job.
- RLS spot-check reusing the cycle-3 audit pattern: a second org cannot see another org's
  `scrape_jobs`/`raw_leads`, and cannot trigger `enrich-apollo`/`enrich-hunter` using another
  org's configured key.

## Out of scope (deferred to later cycles)

- SAM.gov or any other US registry source
- Any country beyond UK/US
- Bulk/automatic Apollo or Hunter enrichment (only the explicit per-lead click)
- CSV export enhancements beyond what `SPEC.md` §5 already describes
