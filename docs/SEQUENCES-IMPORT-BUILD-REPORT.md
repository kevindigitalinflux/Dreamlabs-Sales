# Pain-point review fixes and sequences/packages import

2026-10-29. Codex is builder and sole writer; Claude remains architect/reviewer. Kevin authorised Parts A, B and the appended Part C in the supplied brief. Part C supersedes Part B's earlier exclusion of company-packages import. Independent re-review is pending.

## Scope and revisions

Continued in `C:/Users/kevin/Projects/dreamlabs-sales-painpoint`, branch `codex/pain-point-pick`, from `04fe938`. No other checkout was edited and no branch switch/fetch was performed this round.

- `2f2ddb8`: template-variable exclusions and source normalisation.
- `92fa16a`: local edge regression-test adapter and corrected descriptions.
- `b091a56`: inactive-sequence migration, guards and editor controls.
- `cb13ab5`: both import types, previews, acceptance fixtures and format documentation.
- `cc47299`: whitespace-only cleanup after the change-range check found a blank line at EOF.
- The report and short dated handoff section are committed last. Use `git log` for the documentation HEAD.

All commits use explicit paths, disabled hooks and the requested Codex co-author trailer. The supplied brief, `docs/setup-pack/company-packages.md` and `sequences-import-spec.md` remain untracked and unmodified. The supplied `sequences.md` is committed as the required acceptance fixture; the builder-created package example is also committed. No dependencies changed or were installed this round. No vault sync occurred.

## Part A

Both `buildTemplateVars` copies skip notes beginning with `Pain point pick v1`. Thus an AI pick cannot replace the first ICP line in a template sequence. A newer marked AI note cannot hide an older manual Main pain point note. An unmarked legacy AI summary retains its previous behaviour. Server marker sharing lives in `painPointMarker.ts`; the browser copy duplicates the constant and a runtime regression checks that both copies match. The browser template-variable module imports no server module.

New manual choices use `Manual pain point v1`, so manual changes made through the editor remain eligible for ordinary template filling. The tailored resolver still prioritises manual choices. The AI pick parser now derives `icp_list` versus `proposed` from cleaned list membership while retaining the chosen text and reason. A valid but disagreeing AI source label no longer discards the angle. Invalid labels, including `manual` passed as an AI result, remain rejected; human handling is unchanged.

Required regressions cover both template-variable implementations, the ICP fallback, manual precedence, legacy notes, marker agreement and both disagreeing-source cases. The former parser expectations were updated to the approved normalisation behaviour.

**Not changed:** `saveAiPainPoint` remains a non-atomic read-then-insert, with manual priority on subsequent reads. Review shows the current lead choice rather than an immutable per-email snapshot. These accepted limitations remain from the previous build.

## Part B

`type: sequences` extends the existing deterministic, local Markdown importer. It enforces 1–80-character unique names, at most 100 sequences per file, optional resolvable ICP names, exactly one nonempty Steps section, consecutive numbering from 1, at most 10 steps, and integer waits from 0 through 60. The existing front matter, UTF-8/BOM/CRLF, 200 KB, HTML/image/table and unknown-field checks apply.

The preview shows each name, ICP, step count, inactive status, existing-name match, wait and template resolution. Selected same-batch templates take precedence over organisation templates; names match exactly ignoring case. Ambiguous names are refused rather than arbitrarily choosing an ICP/template. Missing references are shown per sequence and block that selected row's import; it may be unticked. A direct apply revalidates references and reports any failure.

Apply runs after context, profiles, packages and templates. It refreshes the saved template IDs after template creation, maps `wait_days` to `SequenceStep.delay_days`, and writes each sequence and its entire `steps` JSON array in one insert/update. Each step uses the resolved `template_id`, `template_type: custom` and null subject override. New rows are org-owned, non-default and inactive; they do not enrol any lead. Add-new skips existing names; replace changes the matching sequence's steps/ICP and makes it inactive without touching unrelated sequences. Identical replacement steps compare by their fields, independent of JSON key order, and skip unnecessary updates.

Partial failure stops with exact saved/skipped/unsaved labels. An unresolved or refused sequence cannot leave a partial step list: there is no separate step-table write. Existing template/profile apply behaviour is retained. The acceptance test uses the actual 32-sequence/80-step file, eight profiles, eight synthetic template files containing its 80 referenced names plus 40 extra templates, and both earlier setup types. It creates **120 templates and 32 inactive sequences**, then reruns the same add-new batch with **zero writes**. The eight real email-template files were not supplied, so their literal copy was not tested.

## Storage inspection and migration decision

Inspected migration 001, the sequence policy cutover in 003, `auto_draft_on_reply` in 006, category in 043, ICP in 044, and the existing `useSequences` creation path. Sequences already store all steps in `email_sequences.steps JSONB`. One row operation is atomic under existing RLS, so no step table or SECURITY DEFINER import RPC is needed. Import uses the same authenticated sequence creation/update path with an admin-only wizard/apply guard. Existing sequence RLS permits org-member editing; that policy and all grants are unchanged.

The model had no draft/inactive state, and selected Autopilot can choose organisation sequences without an existing enrolment. Treating “not yet enrolled” as inactive would therefore be unsafe. **Migration 071 is required:**

```sql
ALTER TABLE public.email_sequences
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
```

The checked-in migration wraps this additive change in a transaction. It preserves existing rows as active and changes no step data, enrolment, RLS or grant. Imports explicitly write false. The sequence manager lists inactive drafts and its editor offers an explicit activation checkbox. Ordinary sequence choices/enrolment, AI suggestions, selected Autopilot, cold-outreach auto-enrolment and post-send automatic sequence selection exclude inactive rows. Daily sequence processing skips inactive sequences. Existing send/spend counters, eligibility and readiness rules are untouched.

There are no per-sequence stop-on-booking/unsubscribe/reply switches in the current model. Existing reply/opt-out handling stays in place; imports do not add or weaken it. Imported rows set `auto_draft_on_reply: false`, so importing does not enable automatic reply drafting.

`supabase/audits/sequence_inactive_import.sql` is the exact disposable **pre-071 rolled-back dry run** for Claude. Its single DO block adds the column, checks that historical rows stay active and the column is non-null, then raises an explicit PASS exception to roll back the entire block. It deliberately refuses an already-migrated database. **Neither migration nor audit was executed.** SQL runtime, privileges and real activation remain unverified.

There is no unique organisation/name index and no new advisory lock. Sequential reruns are safe; simultaneous imports/direct editor inserts can still race into duplicate names. Existing duplicate names cause an ambiguity error for replacement. Adding a uniqueness rule would require resolving pre-existing duplicates and changing the general editor contract; this build keeps the existing model. Database/network outcomes are not a full-batch transaction: earlier confirmed items can remain saved when later work fails.

## Part C

`type: company-packages` accepts at most 20 case-insensitively unique labels, each 1–80 characters after trimming/collapsing whitespace. Prices, currency symbols and other label text are preserved. No application pricing policy is imposed. Optional body text is parsed and shown literally, with the explicit warning that **details are not stored**.

Add-new appends only new labels, ignoring case. A NULL `custom_packages` becomes a list from the file only, and the preview explains that this replaces use of built-in defaults. Replace sets exactly the selected labels and warns about removed labels that leads may still use. It does not query or modify leads. Existing `package_tier` values remain untouched. Multiple package files may append in file order; replacing requires one package file to avoid ambiguous replacement semantics.

Writes use the same `organizations.custom_packages` update as `CompanyProfileCard`, under its existing column grant/RLS. Confirmed writes call `setOrgPackages` through the wizard callback, including when a later import stage fails. Identical imports skip the write and cache callback. No package migration is needed. **Follow-up:** design storage/editing for package details; no price, timeline or inclusions column was invented.

The seven-label `company-packages-import.md` fixture uses the requested labels. Its body retains the source prices, timelines, inclusions, retainer note and rules as preview-only text. It is one organisation's example; importer code, test names and UI are generic.

## Files changed

- Part A: `src/lib/templateVars.ts`, `painPointReviewFix.test.js`, `painPointPick.test.ts`; shared `templateVars.ts`, `painPointPick.ts`, new `painPointMarker.ts`.
- Import core: `src/lib/mdImport/types.ts`, `parser.ts`, `store.ts`, `apply.ts`; new `extendedSections.ts`, `extendedMatching.ts`, `extendedApply.ts`.
- Import UI: `ImportWizard.tsx`, `ImportWizardView.tsx`, `ImportPreviewCard.tsx`; new `SequencePreview.tsx`, `PackagePreview.tsx`. The touched save-choice dropdown now reuses `SelectField`.
- Sequence activation: `src/types/index.ts`, `useSequences.ts`, `useEnrollments.ts`, `SequenceBuilder.tsx`, `SequenceList.tsx`, `EnrollmentControl.tsx`; server `selectedLeadSteps/load.ts`, `postSendUpdates.ts`, `check-sequences`, `suggest-sequence`, `auto-enroll-cold-outreach`.
- SQL: migration 071 and its rollback-only audit, written only.
- Tests: new `inactiveSequences.test.js`, import `extensions.test.js`, `extendedApply.test.js`, `extendedWizard.test.ts`; extended parser and admin-entry tests.
- Fixtures/docs: both tracked setup examples, `MD-IMPORT-FORMAT.md`, short `HANDOFF.md` section and this report. The format has five tested examples and the correct apply order.
- `scripts/places-edge-typecheck.mjs` now includes the newly changed `auto-enroll-cold-outreach` entrypoint: **25** entrypoints total.

## Verification

Prior task checkpoint `04fe938`: 194 files / 2,740 passing tests. This round adds five test files and 40 tests. Tests preceded implementation: Part A produced four expected failures; the new parser had 16 failures against the old importer; the inactive loader test exposed a draft being offered; missing matching/apply logic and three preview assertions failed before implementation. A JSON-key-order replacement regression failed before canonical comparison was added. All are now green.

Final gates were run **one at a time**, with the required dummy local environment:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS, zero diagnostics |
| `npx vitest run` | PASS, **199 files / 2,780 tests / zero failures** |
| `npm run build` | PASS, **2,938 modules**; existing >500 kB chunk warning remains |
| `git diff --check` and `git diff 04fe938..HEAD --check` | PASS after one trailing blank line was removed |
| `node scripts/places-edge-typecheck.mjs` | PASS, **25 entrypoints**, compiler shim only |

Application revision `cb13ab5`; `cc47299` changes only whitespace. Logs remain ignored local files. No dependency, provider, Supabase, SQL or real mailbox call was made. Subscription usage is unavailable; no percentage is asserted. No background job remains.

Not verified: Deno runtime; real migration/audit/database/RLS/grants; actual source template files; concurrent imports or in-flight automation; uncertain network outcomes; browser interaction, keyboard/screen reader, phone width and both themes; real cache refresh, activation, enrolment, drafting or sending. Unit tests use in-memory client boundaries; component tests render real preview components but do not establish those browser guarantees. Claude re-review is pending.

## Edge manifest and rollout — not executed

A local recursive relative-import audit identifies every entrypoint bundling the changed server `templateVars.ts`: **`check-sequences`, `generate-email`, `run-selected-autopilot`**.

This round's complete shared-module/activation deployment set is 14 entrypoints: `auto-enroll-cold-outreach`, `check-replies`, `check-sequences`, `draft-linkedin-message`, `draft-reply`, `find-decision-makers`, `generate-email`, `parse-csv-leads`, `parse-notes`, `parse-session-notes`, `run-deep-find`, `run-selected-autopilot`, `send-email`, `suggest-sequence`.

If deploying the **whole still-unmerged branch from base `f5d71a6`**, include the earlier pain-point/ICP changes too. The combined exact conservative manifest is **17 entrypoints**: the 14 above plus **`scrape-companies-house`, `scrape-cro`, `scrape-google-places`**. `run-autopilot` has no changed bundled module for this branch; it continues delegating drafting/enrolment to the existing flows.

After Claude's review and Kevin's separate rollout approval:

1. Run the reviewed rollback-only dry run on a disposable pre-071 database. Check the real existing schema/permissions and preserve the previous application bundles.
2. Apply migration 071 before deploying any new edge/frontend bundle that reads or writes `is_active`. The old code tolerates this additive column. Do not deploy the new importer first.
3. Deploy the relevant complete edge manifest; verify inactive drafts cannot be suggested, auto-enrolled or drafted. Do not enrol or contact real leads during verification.
4. Deploy the frontend. Review the real setup batch, inactive sequence rows, manual activation, package preview/cache and second-import no-op; complete phone/theme/keyboard checks.
5. Rollback can restore previous application bundles while retaining the additive column. Imported inactive rows must be removed or otherwise isolated with separate reviewed authorisation before restoring old automation that does not understand `is_active`; blindly rolling back the guards would expose those rows to old sequence selection.

No push, merge, deployment, migration/audit execution, production change, external call, real credential/message, other-checkout write or vault sync occurred. Stop here for Claude's re-review.
