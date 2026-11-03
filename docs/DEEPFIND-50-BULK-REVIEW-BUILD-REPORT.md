# Deep find 50 and bulk review build report

Local build, 2026-11-03. Branch `codex/deepfind-50-bulk-review`. Codex is builder; Claude is architect/reviewer. Independent review pending. No publishing or external calls authorised.

## Built

Both lead caps are 50. Client alert and Pipeline tooltip use the shared constant. Custom AI defaults use `min(200, max(25, ceil(leadCount)))`; Hunter remains 60, limit 500. Existing effort presets and server clamping are unchanged: preset Hunter totals already scale per lead. Changing those would violate the server-behaviour restriction and needs Claude's decision. Custom values remain editable. Confirmation says larger runs take longer, without a numeric estimate: migration 057 schedules every two minutes, but `runDeepFindTick` loops and can process several leads per invocation, claiming one at a time.

No 20-lead cap was found in the inspected Deep find modal, Pipeline selection or Autopilot picker. Picker `z-20` is stacking order. Engine `.slice(0, 20)` limits known people, and 20,000 is a remaining-time check; neither caps leads. Kevin's reported UI value remains unreproduced.

Shared `useRowSelection`, `BulkActionBar` and sequential `runRowBatch` support row selection, actionable Select all, Clear and per-row failures. Deep find ordinary/alternative suggestion groups reuse the same optimistic add/dismiss handler. Role mailbox rows are excluded from bulk selection, with a reason. Success removes selection; failures remain selected and named. Each collapsed alternative group has its own selection. Replacement rows retain explicit single-row replacement to avoid automatically choosing conflicting replacements.

Scrape results add persistent Remove selected through the existing single-row Reject function, with confirmation. Skip remains session-only. Duplicates remain selectable. Mobile has Select all. Approve selected still stops at first failure because approval can involve multiple writes with uncertain partial results. Successful rows now leave selection; failed and unattempted rows stay selected. Rejection continues per row and reports all failures.

LookupSuggestions adds Use selected and local Dismiss selected here. Dismissal lasts only for this component session; there was no persisted dismiss handler. Conflicting selected values for the same field fail explicitly rather than overwrite one another. Single-row thrown errors are now shown. DecisionMakerReview adds selection, grouped Add selected (one patch per lead to preserve additions), and confirmed Remove selected using existing dismissal. No paid reveal is batched.

## Hunter evidence and limitation

`Spend.hunter` refuses exhausted reservations without ending lead processing. Company list loops stop Hunter only, and final stats still produce the lead outcome and a plain cap notice. However, a real exhausted 50-lead run is not verified. Discovery at deepFind.ts around 450 invokes domainDiscovery, whose Hunter name/finder calls around 679 occur before later site reads (783) and awaiting web results (787). Initial site and registry work does precede discovery, but the requested universal own-sources-first ordering is NOT true. Reported for Claude; engine order unchanged as instructed. Do not interpret this build as proof of full Hunter-free completion quality.

## Inventory and remaining scope

More than six surfaces qualify; the brief permits prioritisation. Four high-traffic review surfaces above are built.

| Surface | Decision |
|---|---|
| DeepFindSuggestions / SuggestionRows, including To check and unverified named suggestions | Built; shared component also covers DeepFindLeadResult and run views |
| ScraperJob | Built |
| LookupSuggestions | Built, with explicitly local dismissal |
| DecisionMakerReview | Built |
| ReplacementRows | Deferred; mutually exclusive email replacement choices need a conflict policy |
| DeepFindCompanyChoice | Not a multi-approve list: one company identity must be chosen; bulk dismiss deferred |
| EnrichmentReview | Existing per-field checks and Apply selected; bulk clear/select-all/reject parity deferred |
| SuggestionDiff | Single proposed patch with Apply updates/Dismiss; per-field selection deferred |
| DecisionMakersCard | Separate candidate list; bulk parity deferred |
| DismissedPeople / RestorePersonButton | Restore list qualifies; deferred |
| LookupJob | Per-row save/dismiss review qualifies; deferred |
| Dream Agent ActionRow / ContactActionRow / DismissedRow | Qualifies, deferred; resolutions include editable field and identity decisions |
| AutopilotStatus / SelectedRunSection / NeedsInputRow | Includes individual parked-draft review; multi-select deferred; no send changes |
| Emails ReleaseQueue / dashboard EmailReviewQueue | ReleaseQueue already supports selected release; missing bulk rejection and dashboard parity deferred |
| Emails ReplyAlertParts / SuggestedSequence | Individual reply/sequence proposals; bulk sending/enrolment deliberately outside this build |
| ImportWizard / ImportPreviewCard | Import preview and conflict resolution; separate bulk parity deferred |
| Pipeline contacts/details/domains, attachments, links, user/settings/sequence editors | Existing-data editing/deletion, not suggestion/lead approval lists; not applicable |

This is the permitted priority subset, not completion of every qualifying screen. Claude must review the deferred inventory and Hunter/preset decisions.

## Verification

Dependencies installed offline with npm ci; local MIME/IMAP bootstrap installed offline without scripts. No manifest changes. Initial baseline: 200 passing files, one failed file (missing local IMAP/MIME dependencies), 2,788 passing tests and one skipped. TDD first failed for missing selection module, then passed after implementation. Final gates: explicit `npx tsc --noEmit` zero diagnostics; `npx vitest run` 202 passing files, 2,793 passing tests, one skipped (2,794 total); `npm run build` passed with existing chunk-size warning; `node scripts/places-edge-typecheck.mjs` passed (25 entrypoints); `git diff --check` passed. All full gates used the brief's dummy local Supabase values. The dependency-blocked baseline has one fewer executed test than the final suite after adding four tests, because the previously blocked MIME suite now executes. No baseline result is presented as fully green.

Application commits: `61347ac` (caps and shared primitives), `b55cd6f` (four review surfaces).

Deno, database/RLS, browser interactions, focus, phone width, themes and a real 50-lead run remain unverified. Theme tokens, wrapping layouts, real buttons and labelled checkboxes are used; static/type checks do not prove visual behaviour.

## Rollout and handoff

After Claude review and Kevin's separate authorisation, deploy `run-deep-find` first, then frontend. No migration. No push, merge, deployment, Supabase write, real send, provider call, secret use, other-checkout or vault edit occurred. Subscription usage unavailable; no new percentage asserted. Stop after this report.

## Changed files

- `src/lib/deepFindView.ts`, `src/lib/deepFind.ts`, `src/lib/deepFindRules.test.ts`, `supabase/functions/_shared/deepFindRules.ts`: 50-lead contract, custom defaults and boundary coverage.
- `src/components/deepfind/DeepFindModal.tsx`, `DeepFindConfirm.tsx`, `src/pages/PipelineList.tsx`: defaults, tooltip and duration disclosure.
- `src/lib/rowSelection.ts`, `src/hooks/useRowSelection.ts`, `src/components/ui/BulkActionBar.tsx`, `src/lib/bulkReview.test.ts`: selection and sequential batch primitives with tests.
- `src/components/deepfind/DeepFindSuggestions.tsx`, `SuggestionRows.tsx`, `src/lib/deepFindSuggestionRows.test.ts`: ordinary/alternative suggestion multi-select and async callback contract.
- `src/components/pipeline/LookupSuggestions.tsx`, `DecisionMakerReview.tsx`, `src/pages/ScraperJob.tsx`: other priority review surfaces.
- This report and the appended dated section of `docs/HANDOFF.md`: saved review checkpoint only. Top checkpoints and vault references were not modified.

Remaining test gap: Hunter exhaustion was inspected in source, not exercised end-to-end or in a new engine harness. Existing pure summary tests do not prove runtime completion. DecisionMakerReview remains a large pre-existing component and gained grouped action logic; extracting it and interaction tests should be considered during Claude review. No visual verification is claimed.
