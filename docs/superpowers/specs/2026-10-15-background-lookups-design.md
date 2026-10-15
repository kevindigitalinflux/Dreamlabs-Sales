# Background lookups (Stage 2 of sub-project C) — Design

Date: 2026-10-15. Author: Claude (architect). Status: written; Kevin said "build whatever needs to be built for Stage 2" on 2026-10-15, which is taken as approval to build this scope. Builder: Codex (default role, no role change). Reviewer: Claude. Migrations are applied by Kevin in the Supabase SQL editor after review; deploys need Kevin's go-ahead.

Parent: `docs/superpowers/specs/2026-10-14-worker-integration-design.md` (Stage 1 is live). Related: Jobs tracker spec `2026-10-14-jobs-tracker-design.md`, usage quotas `2026-10-14-usage-quotas-design.md`.

## Why
"Fill in missing details" (`enrich-leads-bulk` / `useLeadEnrichment`) and "Find decision maker" (`find-decision-makers` / `useDecisionMakers`) run inside one browser request. Adding worker calls (scraper up to 25 s, email check up to 20 s) would exceed what a request should wait for, and the user cannot leave the page. Make both background jobs that appear in the Jobs tracker (`/jobs`), like Deep find.

## Decided with Kevin (do not re-ask)
- Background queue with a visible tracker (the Jobs page and bar already exist).
- Free tools first; Hunter/Apollo only to fill gaps; worker calls only through `supabase/functions/_shared/workerClient.ts` (reserve usage first, refund at most once and only when the worker did no work, fail closed, client timeout not refunded).
- Review-before-send: nothing emails anyone, and found/guessed addresses are proposals, never auto-added to sequences. Only an address the email checker calls `valid` may be filled automatically, and only into a blank field of an existing contact (same rule as Deep find).
- Per-organisation usage limits already exist (`usage_reserve`); no new paid service.

## Scope
1. A generic lookup job: `kind` is `enrich` (Fill in missing details) or `decision_makers` (Find decision maker), over one or many leads selected in the pipeline.
2. Click creates the job and returns at once; a cron-driven tick does the work; progress and results show in `/jobs`.
3. One new `JobSource` adapter for the Jobs tracker.
4. The two existing buttons switch to creating a job (keep the old synchronous path available behind a small flag only if removing it is risky; prefer replacing it).
5. Worker use inside the jobs: `enrich`: when `scrapeWebsiteContact` finds no email and no phone for a lead with a website, one `workerClient.scrapeSite(domain, 'key_pages')`; scraped addresses on the lead's own domain become proposed `email`/`phone` values with source "browser scraper" (same validation as `parseScrapeReply`). `decision_makers`: no new worker step (Hunter/Apollo only) but runs in the background with the same limits.
Out of scope: Firecrawl, per-org worker keys, desktop pop-ups, changing Deep find, emailing anyone.

## Data model (new migration `061_lookup_jobs.sql`; audit script `supabase/audits/lookup_jobs_rls.sql`, rolled back)
- `lookup_jobs`: `id uuid pk`, `org_id uuid not null` (FK organizations), `created_by uuid` (FK profiles), `kind text check in ('enrich','decision_makers')`, `status text check in ('active','completed','cancelled')`, `lead_count int`, `created_at`, `finished_at`.
- `lookup_job_leads`: `id uuid pk`, `job_id` (FK lookup_jobs on delete cascade), `org_id`, `lead_id` (FK leads on delete cascade), `status text check in ('queued','running','done','failed','skipped')`, `reason text` (plain-English line, never raw provider text), `result jsonb` (see below), `review text check in ('none','pending','applied','dismissed') default 'none'`, `claimed_at`, `updated_at`; unique `(job_id, lead_id)`.
- `result` for `enrich`: `{ proposed: {email?,phone?,owner_name?,website?}, source: {...}, steps: string[] }` (the existing `EnrichResult` plus plain step lines). For `decision_makers`: `{ stored: number, steps: string[] }` (candidates are stored in `decision_maker_candidates` as today, never overwriting).
- RLS: members of the org can SELECT; INSERT through an RPC or edge function only (service role) so the tick can validate `can_edit_lead`; DELETE allowed for the creator or an org admin when `status <> 'active'` (mirror migration 060); no client UPDATE except `review` set to `applied`/`dismissed` on rows of their own org via a SECURITY DEFINER RPC `lookup_job_review(lead_row, new_review)`. Include GRANTs explicitly (see 060 for the pattern: policies without grants silently deny).
- Realtime: `alter publication supabase_realtime add table lookup_jobs, lookup_job_leads;` (REQUIRED, otherwise the Jobs channel would be rejected).
- Claim function `lookup_job_claim(max_leads int)` modelled on `deep_find_claim` (atomic, `for update skip locked`, marks `running`, requeues stale `running` rows after a timeout), SECURITY DEFINER, executable by service role only.
- Per-organisation daily limit: reuse `checkRateLimit` (e.g. 300 lookup leads per organisation per day, 5 per lead per day) like Deep find, with plain skip reasons.

## Edge function `run-lookup-jobs` (new; model on `run-deep-find/index.ts`)
- `POST` (user JWT): body `{ kind, lead_ids: string[] }` (max 50). Validates org membership and `can_edit_lead` for each lead server-side, inserts the job and its rows, answers `{ job_id, queued }`, then kicks one tick in the background.
- Cron tick (header `x-cron-secret` compared with `cronSecretMatches`, same as run-deep-find): claims one lead at a time within a wall budget (same constants style as `deepFind.ts`), runs `enrichOneLead` / `findAndStoreDecisionMakers` (both in `_shared`; reuse unchanged where possible), writes `status/result/reason`, completes the job when no row is queued or running. A `pg_cron` entry (migration or documented SQL) calls it every minute like Deep find; record it in `docs/AUTOMATIONS.md`.
- Cancel: `POST { action: 'cancel', job_id }` marks active job `cancelled` and its queued rows `skipped`.
- Never return secrets or raw provider text; failures are fixed sentences.

## Jobs tracker adapter (front end)
- Append one `JobSource` (`lookup`) to `JOB_SOURCES` in `src/lib/jobs/sources.ts`, add `lookup_jobs` to `JOB_TABLE` (deletable), `watch: lookup_jobs, lookup_job_leads` (both published by the migration). Pure mapper `mapLookupJob(job, rows, names)` in `src/lib/jobs/` with unit tests: title via `nameLeads` ("Fill in details: Love Living, X +3" / "Find decision makers: ..."), `running` while active, `done`/`failed`/`stopped`, `needs_you` when an `enrich` job has rows with `review = 'pending'` (count = those rows), href `/jobs/lookup/:jobId`, `canStop` when active, `canDelete` per migration rule, `deleteWarning` "Proposals you have not reviewed are removed too. Details already applied to leads stay."
- Page `/jobs/lookup/:jobId` (Open link): per lead, the steps and, for `enrich`, the proposed values with Apply / Dismiss, reusing the existing apply logic and components from `EnrichmentReview` (`src/components/pipeline/EnrichmentReview.tsx`) rather than duplicating them. Apply writes to the lead through the existing client code path (RLS applies), then sets `review = 'applied'`.
- Buttons: "Fill in missing details" and "Find decision maker" create a job and show a plain confirmation ("Started: N leads. Follow it in Jobs.") with a link to `/jobs`. Update `useLeadEnrichment.ts` / `useDecisionMakers.ts` accordingly.

## Edge cases
Lead deleted mid-job: row `skipped` with a plain reason. Creator loses edit rights: `skipped`. Worker off/limit/down: the worker step is skipped with the standard line from `workerClient.lines()`; the rest of the lead still runs. A tick that dies mid-lead: stale `running` rows are requeued (bounded retries, then `failed`). Switching organisation: the Jobs provider already drops other-organisation data.

## Testing and verification
- Unit (vitest): `mapLookupJob` (every state, needs-you wins over running, titles, delete rules), any new pure rule modules (import-free, e.g. `lookupJobRules.ts`: statuses, skip reasons, limits), `workerClient` unchanged.
- Audit SQL (rolled back, new file) covering: members read only their organisation's jobs; delete rules (creator/admin, never `active`, other org no, anon no); no direct INSERT/UPDATE from clients; `review` RPC only touches the caller's organisation; claim function not executable by `authenticated`.
- Live check (Claude with Kevin, after Kevin applies the migration and deploys are authorised): start both job kinds from the pipeline, watch the row appear within seconds in `/jobs`, see "needs you" for pending proposals, apply one, stop one, delete one, usage meter moves.
- Gates before handing back: `npx tsc --noEmit`, `npx vitest run`, `npm run build` all green.

## Success criteria
1. Both buttons return at once and the work appears as a named job in `/jobs` with progress and a "needs you" state for proposals.
2. Nothing is applied or added to sequences without a human step; only `valid` checker results may fill blank fields (and only through the existing rules).
3. Worker use obeys reserve/refund/fail-closed; with the worker off the jobs still run on the existing free steps.
4. A new job type needed one adapter and no change to the Jobs page or bar.
