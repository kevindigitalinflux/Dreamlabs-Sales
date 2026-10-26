# Readiness and Autopilot fixes — local build report

Date: 2026-10-26. Builder: Codex. Architect/reviewer: Claude; independent review pending.

## Scope and revisions

Worktree: `C:/Users/kevin/Projects/dreamlabs-sales-readiness`. Branch: `codex/readiness-and-fixes`.
Starting revision: `139ba5c3982506714b43c1c927e31644b68a7660`, the supplied brief on top of `origin/main` at `ece88ed`. Initial working tree was clean.

Approved scope: `docs/READINESS-AND-FIXES-BUILD-BRIEF.md`, readiness section 3d of the one-engine design, the Build B readiness paragraph, and `docs/TODO.md` C8–11. Part 3e was not built; existing effort/depth/concurrency logic was left intact.

Local commits:

- `ff2c24a`: readiness rule, engine completion write, UI, migration/audit and tests.
- `365a8d121b13fd1aacfa929b334bb854e959d6d7`: Autopilot reliability fixes and expanded edge shim. This is the final tested application revision.
- `118bd80`: project instructions, handoff, automation register and next-step checkpoints.
- The report itself follows in a final documentation-only commit. Use `git log` for its hash.

All commits use explicit staged paths, `git -c core.hooksPath=NUL commit`, and the required Codex trailer. No dependency was added. No push, merge, deployment, SQL/migration/audit execution, remote write, external-service lookup, actual send or other-checkout edit occurred. No vault synchronization ran because this brief restricts work to this worktree. Subscription usage is not exposed; no percentage is asserted.

## Part 1: readiness 3d

Built a pure `leadReadiness.ts` rule with `ready`, `almost` and `needs_work`, stable missing-fact keys and shared readable explanations. Ready requires all three saved facts: a named decision maker, a checker-valid email on a live contact or lead, and the saved website confirmed as the company's site. One absent fact means Almost; two or more mean Needs work. A suspected wrong site or a foreign saved phone on an explicitly GB lead overrides the otherwise-ready result to Needs work.

Definitions reused:

- `deepFindRules.ts`'s `parseLeadPersonName` parses names. The surname must also contain at least two letters, excluding a dotted initial; this follows the full-name safeguard used in registry people evidence. General inboxes, hidden names and dismissed people do not establish a decision maker. A saved owner name qualifies; any live named contact with a nonblank role qualifies, including manual contacts. `isOwnerRole` and existing dismissal rules are reused.
- The existing Deep find and `personEmailFinding.ts` verification boundary is preserved: a successful checker verdict with `status === 'valid'`. Catch-all/risky/unverifiable, unavailable checks, Hunter provenance alone and plausible email text do not establish verification. A valid unsaved suggestion cannot make the lead ready. Only addresses still saved at completion count.
- Confirmed website uses the engine's existing `needs_check === false` plus `site_confirms` evidence for the currently saved domain. `domainFromWebsite`, directory exclusion and saved blocked-domain rules are reused. MX alone or a saved URL alone is insufficient. No new provider request is introduced.
- Foreign-number detection calls shared `phoneNumbers.ts`'s `parsePhone`; it examines current lead and additional phones, ignoring malformed text and historical metadata. `phone_meta`, contact `phone_kind`, existing phone filters and the contact-phone projection in `useLeads.ts` are preserved.

At successful lead completion, Deep find rechecks authorization, re-reads saved lead/contacts after automatic fills, computes readiness, and conditionally updates the lead using its organization and current `updated_at`. A failed read/save or a concurrent lead edit fails completion instead of claiming the badge was saved. The run result includes readiness/missing keys and text such as `Almost: no verified email`, at the beginning of the summary and in its step lines. Failed/skipped leads retain their previous completed assessment.

The badge appears on pipeline list rows, Kanban lead cards, the side panel and full lead page. Pipeline readiness filtering sits beside the phone filters. Sorting uses Ready, Almost, Needs work, with Not checked last in either direction. Null/absent values display Not checked. Text carries the reason without hover or colour dependence; existing theme text/surface tokens and wrapping are used. The list retains its existing inner horizontal-scroll container. Browser and actual phone-width checks remain pending.

### Migration, grants and audit decision

Reserved `supabase/migrations/065_lead_readiness.sql` is additive: two nullable columns, the readiness allowlist constraint, comments, no backfill and no privilege/policy/guard changes. The numbering gap after applied 068 is intentional per the brief. It has not been applied.

Migration 038 documents the existing table-wide authenticated UPDATE grant on `leads`; audit 068 also relies on new lead metadata inheriting it. Therefore merely omitting a new grant cannot make readiness server-only. This build adds no UPDATE grant and preserves the existing grant model, RLS and guards exactly as required. The application writes readiness only through the Deep find service path, but an editor with existing lead UPDATE rights can also write these columns through the direct API. This is **not database-enforced server-only metadata**. It is informational and grants no send/enrollment authority. Enforcing a stronger server-only boundary would require a separately reviewed permission/guard design; it was not silently introduced. Actual live privileges were not queried.

The rollback audit has two independent `DO $$` blocks, each ending with a deliberate `RAISE EXCEPTION`:

1. **Read-only assertions**, suitable for separately authorized production execution: column types/nullability, readiness constraint, RLS enabled, inherited grants and service-role write privilege. It creates no users or other fixtures.
2. **Disposable local database fixtures only**: a fresh auth user, organization, pipeline and lead, null defaults, all allowed readiness values, invalid-value rejection and reset to null. Never run this block on production.

Neither audit block was executed. No extra migration was needed for Part 2.

## Part 2: Autopilot reliability

| TODO | Local behavior | Regression evidence |
|---|---|---|
| C8 | Mailbox settings reads, Vault RPC errors and rejected reads retry up to three attempts, with 250 ms then 500 ms pauses. Fixed context/attempt logging omits database and secret payloads. Exhaustion returns 503; selected Autopilot leaves the run active and its leads untouched for the next tick. Genuine unverified settings or a genuinely absent password remain configuration failures. | Transient read recovery, rejected read plus RPC recovery, bounded exhaustion, unchanged safe cancellation and no lead work during mailbox failure. |
| C9 | Shared org/lead-scoped lookup makes `check-sequences` leave a lead with any unsent linked Autopilot draft/failed log alone. No age cutoff. A lookup error defers safely. The existing individual review flow still owns advancing a linked parked draft. | Actual cron handler against local database doubles: parked draft/failed log holds step 2 without draft or enrollment writes. Server post-send remains `link_only`; the existing review action advances step 2 to step 3 once. |
| C10 | Waiting to release loads only bulk-safe drafts and rechecks them before release. Any Autopilot-linked log is excluded, as is the interrupted-send marker even without a surviving link. A failed safety lookup returns an empty queue and an error. Ordinary manual/sequence drafts remain eligible. The queue links to individual Autopilot review; existing individual-review screens and their reasons are preserved. | Parked, interrupted and orphan-marker drafts excluded; ordinary sequence/manual drafts retained; lookup error fails closed; no-org query is skipped. |
| C11 | Pending-review leads are hidden from the later-run picker and pruned from stale selections. The server independently repeats the unsent-draft guard before enrollment/blocklist/pipeline work. Failure to read draft state fails closed. Sent/discarded drafts cease blocking when no unsent linked log remains. | Picker grouping/pruning plus actual selected-run precheck with draft/failed logs, lookup errors and the clear path; pipeline work never starts for blocked leads. |

The shared guard deliberately covers all unsent Autopilot-linked logs, including interrupted/working cases, rather than relying solely on the earlier run's `needs_input` status. Existing status links and RLS suffice; no schema, usage cap, reserve behavior or send authorization changed. These are targeted guards, not a redesign of concurrent sequence/send processing or the existing individual-review lifecycle.

## Files changed

Readiness engine/schema:

- `supabase/functions/_shared/leadReadiness.ts`
- `supabase/functions/_shared/deepFind.ts`
- `supabase/migrations/065_lead_readiness.sql`
- `supabase/audits/065_lead_readiness.sql`
- `src/types/index.ts`
- `src/lib/leadFilters.ts`

Readiness UI:

- `src/components/pipeline/ReadinessBadge.tsx`
- `src/components/pipeline/FilterBar.tsx`
- `src/components/pipeline/ListTable.tsx`
- `src/components/pipeline/LeadCard.tsx`
- `src/components/pipeline/LeadPanel.tsx`
- `src/pages/LeadDetailPage.tsx`

Reliability implementation/check tooling:

- `supabase/functions/_shared/sendLeadEmail.ts`
- `supabase/functions/_shared/selectedAutopilot.ts`
- `supabase/functions/_shared/autopilotDrafts.ts`
- `supabase/functions/check-sequences/index.ts`
- `src/lib/releaseDrafts.ts`
- `src/lib/selectableLeads.ts`
- `src/hooks/useDrafts.ts`
- `src/hooks/useSelectableLeads.ts`
- `src/components/emails/ReleaseQueue.tsx`
- `scripts/places-edge-typecheck.mjs`

Tests:

- New: `src/lib/leadReadiness.test.ts`, `readinessBadge.test.ts`, `senderMailbox.test.js`, `autopilotReliability.test.js`, `parkedSequence.test.js`, `releaseDrafts.test.js`.
- Extended: `src/lib/leadFilters.test.ts`, `selectableLeads.test.ts`, `deepFindPhase3Engine.test.js`, `deepFindFirecrawl.test.js`.

Documentation: `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`, `docs/AUTOMATIONS.md`, `docs/NEXT-STEPS.md`, `docs/TODO.md`, and this report. Total: 39 changed files including this report.

## Gates and TDD

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS, 0 diagnostics |
| `npx vitest run` | PASS, **163 files / 2,501 tests / 0 failures**; 47 tests above the supplied 157-file / 2,454-test baseline |
| `npm run build` | PASS, **2,904 modules**; chunk-size warning remains (chunks above 500 kB) |
| `git diff --check` and full change-range whitespace checks | PASS, 0 whitespace errors |
| `node scripts/places-edge-typecheck.mjs` | PASS, **14 entrypoints**, including newly added `check-sequences` and `send-email` coverage |

Tests were written before implementation. Initial runs exposed absent readiness exports/writes, incorrect readiness filters/order, mailbox errors treated as 400, later runs reaching pipeline work despite parked drafts, and the actual daily cron advancing step 2 to step 3 before review. After implementation the targeted suites passed. The first full run reported 22 failures in the legacy Firecrawl engine test file: its database double returned a scalar for lead UPDATE results and counted every new badge write as forbidden contact/detail mutation. The double now supports the expected update response and separately records readiness-only writes; its original contact/detail assertions remain, with a dedicated completed-assessment regression. Final full suite passes with no unresolved failures.

Final suite/build used only `VITE_SUPABASE_URL=http://127.0.0.1:54321` and `VITE_SUPABASE_ANON_KEY=local-test-placeholder`. Local fake database/provider boundaries were used; no real SMTP, Vault, provider or Supabase operation ran. Failure-path tests intentionally emit bounded log messages. Ignored `.superpowers/readiness-vitest.log`, shim scratch files and `dist/` remain local and are not committed.

## Unverified and review handoff

Not verified: Deno runtime/import resolution; actual SQL migration/audit execution, grants, RLS or constraint behavior; live PostgREST reverse relationships; browser interactions, keyboard/focus, phone widths or rendered contrast in both themes; real mailbox/Vault/SMTP/provider runs; live Deep find/Autopilot runs; deployment. Unit/static-render tests do not establish browser or database behavior. There is no independent review yet.

Custom effort retains its existing check schedule: readiness consumes valid verdicts already obtained during that run and does not add verification calls. A saved address without such evidence remains unverified. Readiness is a last-completed-run snapshot; later manual edits do not automatically recompute it.

Exact affected edge deployment list, **for later reviewed and separately authorized rollout only**:

1. `run-deep-find`
2. `run-selected-autopilot`
3. `check-sequences`
4. `send-email`

The frontend also needs its normal reviewed publication to expose the badges, filters and bulk-release changes. Migration 065 must be reviewed and separately authorized/applied before the readiness completion write is deployed. Production may receive only the audit's read-only block; the local fixture block must remain local.

Next action: Claude reviews `139ba5c..365a8d1`, this report and the unapplied SQL/audit. Kevin separately authorizes any subsequent database execution or publication after review. Builder stops here.
