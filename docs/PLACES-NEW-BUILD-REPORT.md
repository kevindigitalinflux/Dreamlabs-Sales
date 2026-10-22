# Places API (New) local build — 2026-10-22

## Scope and state

Kevin authorized Codex to build the Enterprise Text Search design in `docs/superpowers/specs/2026-10-22-places-api-new-design.md`. Roles remain Codex builder and Claude architect/reviewer. Work is confined to `C:/Users/kevin/Projects/dreamlabs-sales-places`, branch `codex/places-new`, based on `9bafbf4b910eb02b27b2e17f751b78d5ca637579`. The other checkout was not accessed or changed.

Implementation is local and committed. Independent architect review is pending. No SQL was applied, no SQL audit or concurrency test was run, and no Supabase or Google provider was called. No push, merge, deployment, remote write, paid API call or real-person message occurred. Commit hooks were disabled per invocation because the existing sync hook would overwrite accepted main documents in the vault. Subscription allowance telemetry is unavailable; no percentage is asserted.

## Implementation

- Import-free helpers cover the exact Enterprise field mask, request body, result/contact mapping, missing fields, errors, fallback admission, Pacific billing months and fail-closed reservation parsing. Helper tests preceded the transport and integrations. Initial red runs recorded missing new modules; subsequent tests exercised real helpers and local fake transports.
- The shared client sends New API keys only in headers. It makes at most three Text Search pages without New-path delays or Place Details requests. Single-business matching still selects the strongest of the top three results and uses actual locality/postal-town evidence.
- Only `not_enabled` selects the existing legacy Text Search/Details protocol. Legacy pagination retains its delay and partial-result behavior for a premature page token. Transport errors are replaced with safe messages, including legacy errors that could carry a key-bearing URL. Concurrent lookups share the initial capability probe.
- Every routed search reserves before dispatch and fails closed on an RPC error, throw or malformed result. Scrapes reserve three search events and refund pages never attempted. A single-business search reserves one. Provider failures retain the attempted event. Reservations include provenance and an id for one-shot unused-page refunds.
- New additive migration 067 supplies organisation limits/counters, a shared fallback-key pool, private reservation records, admin-only limit editing, service-only reserve/refund and a member-checked snapshot. The default organisation and shared limits are both 900. Billing months use `America/Los_Angeles`.
- An optional provenance callback leaves the existing key resolver return value, Vault calls, key precedence, `use_global_api_fallback` and provider values unchanged. Own keys do not consume the shared pool; unknown provenance defaults conservatively to shared.
- Callers include the scraper, Deep find, background lookups, bulk enrichment, selected autopilot and registry scrapers. Capped Deep find/background lookups add a plain step line and continue other sources.
- Settings has one visible Google Places key card, corrected New API setup and free-usage copy, Google budget/quota instructions, a monthly meter and an admin-only 0–100,000 limit editor. The meter tolerates an absent migration. The stored `google_places_pro` provider and its validator remain available in code/database.

## Local gates

All final gates passed after the last behavioral changes:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | Passed, zero diagnostics |
| `npx vitest run --reporter=json --outputFile=.superpowers/places-check/vitest-final.json` | 141 files, 2,216 tests, zero failures |
| `npm run build` | Passed, 2,785 modules, zero errors; existing chunk-size warning |
| `node scripts/places-edge-typecheck.mjs` | Passed, zero diagnostics across nine actual entrypoint import graphs |
| `node --check scripts/places-concurrency-test.mjs` | Passed syntax check only; script not executed |
| `git diff --check` | Passed |

The worktree initially lacked dependencies. `npm ci --ignore-scripts` installed the lockfile without modifying it. Tests used process-local dummy `VITE_SUPABASE_URL=http://127.0.0.1:54321` and `VITE_SUPABASE_ANON_KEY=local-test-placeholder`; no real credential or project environment was copied. The first full suite exposed a missing local environment in `hunterLimits.test.ts`, an old three-argument assertion in `deepFindPhase3Engine.test.js`, and two literal resolver assertions in `scrapeMerge.test.ts`. Those assertions now include the usage context/provenance callback. The subsequent full suite passed; final fallback-state sharing justified one further full gate run, also green.

The shim maps the installed Supabase types, declares Deno `serve`/`env.get`, and supplies a minimal declaration for the existing remote SMTP import. It is not `deno check` or Deno execution. A pre-existing `contact.source` narrowing issue exposed by the actual edge graph was fixed with a string type guard; runtime behavior for valid source values is unchanged.

Not verified: Deno runtime, migration syntax/execution, database grants/RLS behavior, rolled-back audit results, database concurrency, browser behavior/mobile layout, real key validation, provider fields/pagination, live quota accounting, or independent architect review. The audit is a single DO block ending with the mandatory uncaught `RAISE EXCEPTION 'PLACES_AUDIT %', report`.

## Specification clarifications and architect decisions

1. **Migration number:** 067 is the next available number after explicitly reserved 065 and platform-owners 066. The local migration directory was checked; the other checkout was not inspected.
2. **Snapshot grants:** the spec calls all RPCs service-only but also requires a browser meter and a membership check like `usage_snapshot`. Reserve/refund are service-only; snapshot is executable by authenticated members and checks membership internally. The architect must confirm this resolution.
3. **Refund signatures and provenance:** reserve adds `p_shared`; refund adds `p_reservation`. A private reservation ledger prevents duplicate/cross-org refunds and records which pool to decrement. The resolver uses an optional callback rather than changing existing callers to return `{ key, source }`. The architect should review these additive interfaces and lock order.
4. **Fallback memory:** each scrape/enrichment request shares its context; queued Deep find, lookup jobs and selected-autopilot share state across leads of the same run/job within a tick. A later serverless invocation probes New again. Durable caching across cron ticks was not added because it would require a persisted capability/configuration lifecycle beyond the spec. The architect must decide whether once per invocation is sufficient for “once per run”. Failed capability probes do not represent successful billable searches.
5. **Legacy accounting ambiguity:** counters represent Text Search events, following the explicit three-event scrape and one-event business-lookup contracts. Existing legacy Details calls remain unchanged and do not reserve additional events. This is not a cap on every legacy SKU or every Google charge. The architect must rule whether Details also need separate reservations before rollout; that would change the explicit single-business reservation contract and reduce legacy capacity.
6. **Provider reasons:** fixed, classified Google reason messages replace verbatim provider text so a response cannot echo a key or key-bearing URL. Billing and website/app restrictions receive specific guidance. Full raw Google reasons/project numbers are deliberately not displayed.
7. **Concurrency test:** the prepared script only accepts an explicitly selected disposable local PostgreSQL database; it never reads project `.env` or invokes the Supabase Management API. This adapts the older remote script to this task's no-Supabase/no-remote-write boundary. It remains unrun and requires `psql` plus applied migrations and fresh authorization.
8. **Meter refresh:** the meter polls while the page is visible rather than adding a realtime publication. Unsaved limit edits survive refreshes. The shared cap is server-managed and cannot be raised by a client-org admin; changes require a separately authorized reviewed database operation.

## Review and rollout handoff

Review these local commits against the base:

- `dc15f77ff02d462cb7d6b2e50d36667c4ed3f869` — pure helpers/tests.
- `e6820aaa6bcd742965ae5d56cd67c52fb75583f1` — migration, rollback audit, prepared local concurrency script.
- `e365eae82585f824cf272fe212058aafa1042bf7` — guarded client, callers, tests and reproducible edge shim.
- `7fce0df1f5074c9b4e7bd84d2ab3e49cad63ae5f` — Settings meter and setup guidance.

A final documentation commit follows these code commits. Every commit uses Kevin's requested Claude Sonnet 5.5 co-author trailer. Do not merge or publish from this handoff. First reconcile with `codex/platform-owners` after its independently reviewed merge, especially `org-api-settings/index.ts`; recheck that migration 067 remains available at that time.

After architect review and Kevin's separate authorization: apply migration 067, run and inspect the rolled-back audit, validate concurrency, deploy the affected functions, then publish the frontend. The affected deployment list found locally is `org-api-settings`, `scrape-google-places`, `run-deep-find`, `enrich-leads-bulk`, `run-autopilot`, `run-lookup-jobs`, `run-selected-autopilot`, `scrape-companies-house`, and `scrape-cro`. Other consumers of the changed key resolver keep the same return/secret behavior; deployment review should still inspect their import graphs.

The first live check remains Valentina's key validation and a 20-result scrape with website, phone, rating, and a one-event meter increment. Then confirm Kevin's shared fallback pool, legacy behavior and month boundary. No live step is authorized by the local build request.

## Changed files (40)

- `AGENTS.md`
- `CLAUDE.md`
- `docs/AUTOMATIONS.md`
- `docs/HANDOFF.md`
- `docs/NEXT-STEPS.md`
- `docs/PLACES-NEW-BUILD-REPORT.md`
- `docs/superpowers/specs/2026-10-22-places-api-new-design.md`
- `scripts/places-concurrency-test.mjs`
- `scripts/places-edge-typecheck.mjs`
- `src/components/settings/PlacesUsageMeter.tsx`
- `src/lib/deepFindPhase3Engine.test.js`
- `src/lib/googlePlacesSafety.test.ts`
- `src/lib/orgApiKeys.test.js`
- `src/lib/orgApiSettings.test.js`
- `src/lib/organizationSettings.test.ts`
- `src/lib/placesClient.test.ts`
- `src/lib/placesNew.test.ts`
- `src/lib/placesSettings.test.ts`
- `src/lib/placesSettings.ts`
- `src/lib/scrapeMerge.test.ts`
- `src/pages/OrganizationSettings.tsx`
- `supabase/audits/places_usage.sql`
- `supabase/functions/_shared/deepFind.ts`
- `supabase/functions/_shared/enrichLead.ts`
- `supabase/functions/_shared/googlePlacesLookup.ts`
- `supabase/functions/_shared/lookupJobs.ts`
- `supabase/functions/_shared/orgApiKeys.ts`
- `supabase/functions/_shared/placesClient.ts`
- `supabase/functions/_shared/placesNew.ts`
- `supabase/functions/_shared/registryContacts.ts`
- `supabase/functions/_shared/selectedAutopilot.ts`
- `supabase/functions/_shared/selectedLeadPipeline.ts`
- `supabase/functions/_shared/selectedLeadSteps/load.ts`
- `supabase/functions/_shared/selectedLeadSteps/types.ts`
- `supabase/functions/enrich-leads-bulk/index.ts`
- `supabase/functions/org-api-settings/index.ts`
- `supabase/functions/scrape-companies-house/index.ts`
- `supabase/functions/scrape-cro/index.ts`
- `supabase/functions/scrape-google-places/index.ts`
- `supabase/migrations/067_places_usage.sql`
