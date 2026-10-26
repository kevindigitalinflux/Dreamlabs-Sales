# MD setup import and template duplicate — build report

Date: 2026-10-26. Builder: Codex. Independent reviewer: Claude, pending.

## Revision and scope

- Worktree: `C:/Users/kevin/Projects/dreamlabs-sales-md-import`.
- Branch: `codex/md-import-build`; starting revision: `2ca184c`.
- Parser/apply commit: `3da6e3f`.
- Wizard/duplication commit: `6ed94a5ac7da6f115afb1d7af5395d6978a7e7c6` (tested application revision).
- The final documentation commit follows that revision; use `git log` for its hash.
- Built the approved design and format contract. The design file still says DRAFT; Kevin's explicit build instruction and build brief identify it as the approved scope. The source specification was not edited.
- No new dependency, migration, edge function, table, automation, RLS change or shared-test change.
- No external service call, remote write, real credential use, email, message, push, merge or deployment. Existing local dependencies were used. No other checkout or vault file was changed; vault sync was deliberately not run under this worktree-only scope.

## What was built

The pure parser identifies all three file types, retains source line numbers, normalizes BOM/line endings, validates exact headings/metadata/list/link syntax, enforces file/item/name/section limits, and rejects binary/invalid text, HTML, images and tables. Bodies remain plain text, with internal spacing and paragraph breaks preserved. It warns about unknown placeholders, missing unsubscribe links, and the two placeholders the format discourages. Custom placeholder keys come from the current user's RLS-visible organization data.

Admin-only entry points in Settings and Templates open the same wizard. It supports choosing/dropping multiple local files, removing individual files, per-file errors/warnings/counts, per-row selection, profile/template matching, context replace/append, and add-only/replace choices. Current and incoming context are shown together; profile and email details can be expanded. Unresolved ICP rows start unticked and require explicit consent to import without an ICP. Unchecking/removing a batch profile also removes implicit consent from its dependent templates.

Apply rereads org-scoped data, then saves context, profiles and templates in that order. New profiles and new templates each use a bulk insert; replacements update existing IDs. Returning rows are checked, including silent RLS refusal. Template replacements never set `is_default` or `attachments`. On failure, processing stops and the summary lists saved, skipped and unsaved items. Reopening is required before another attempt. Both success and partial success refresh the affected lists.

Templates have Duplicate actions on cards and in the editor. A copy uses the current org/user, `template_type: custom`, `is_default: false`, and collision suffixes in its ICP. The editor opens on the saved copy. The set-copy dialog offers source and target ICPs, selects all source templates initially, allows exclusions, previews target names, and creates copies with the target ICP. Existing save/delete/editor behavior is retained.

The new UI uses existing Button, Skeleton, CategoryBadge and Modal components. Alerts/status regions, normal file selection, labeled controls, focus-trapped dialogs, wrapping text and 44 px checkbox rows are present. Browser behavior remains unverified below.

## Attachment rule

**Stored files are retained; copies keep references.** `useTemplates.remove` deletes only the `email_templates` row. `AttachmentFiles` explicitly detaches references without deleting stored files because earlier drafts may still use them. Migration 041 has storage policies but no template-deletion storage cleanup. No matching cleanup trigger was found in the migrations. Both single and set copies therefore retain attachment references and links. Imported Markdown never imports attachments. Real storage access, including references from shared templates, was not exercised.

## Tests and gates

Tests were written before their implementation, run against missing behavior/stubs, then made green. Observed red phases covered parser validation, matching/copy naming, apply behavior, wizard states, file handling and copy persistence. A further red regression run caught duplicate context appends and missing-profile fallback before those were fixed.

Seven new test files contain **52 tests**. They cover the three examples extracted directly from `docs/MD-IMPORT-FORMAT.md`, exact parsed example data, validation and limits, placeholders, BOM/CRLF, case-insensitive matching, profile resolution, copy ownership/naming/attachments, fake Supabase writes and refusal, partial failures, full-batch rerun safety, file-read errors, and rendered wizard states/admin visibility.

All four final gates passed using dummy local environment values (`http://127.0.0.1:54321` and `local-test-placeholder`) for the full suite/build:

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed; 0 diagnostics |
| `npx vitest run` | Passed; 152 test files, 2,390 tests, 0 failures |
| `npm run build` | Passed; 2,803 modules transformed, 0 errors |
| `git diff --check` | Passed; 0 whitespace errors |

Test file count was also checked with `npx vitest list --filesOnly`. The production build retained the existing warning for chunks over 500 kB. It was not treated as a new feature failure. No package installation or dependency change was needed.

## Decisions where the specification needed detail

- Import replacement candidates include only current-org templates. A global/shared template is never overwritten by the importer; an org-owned row is created instead. Duplication still accepts visible shared/default sources.
- One selected company-context file is permitted per batch. Other files remain in place when a conflicting context file is removed or unticked.
- Context reruns are no-ops when the incoming context already equals current text, or append mode finds that exact context at the end after a blank line. This makes a full rerun safe without repeated appends.
- Duplicate profile/template keys across a batch are handled deterministically: new rows are reserved in memory and later add-only occurrences are skipped. Existing ambiguous matches follow first visible match; the schema does not provide a template-name uniqueness constraint.
- Apply checks a fresh snapshot before writes. If a previously resolved ICP disappeared, it stops before any save unless the row explicitly permits an empty ICP.
- List sections become newline-separated text without `- ` markers, matching the existing ICP editor and pain-point consumer.
- Optional blank ICP/category overrides clear file defaults. A template with no requested ICP is deliberately unassigned and selected normally.
- Body/subject sections use the design's 3,000-character ceiling; imported template names use its 80-character ceiling. Names generated by duplication are not truncated.
- Set-copy names also receive `(2)`, `(3)` collision suffixes. Names are checked again immediately before insert. Another user's concurrent changes may alter a suffix from the earlier preview; concurrent template naming cannot be made atomic without database support outside this scope.
- The apply instructions explicitly require partial-failure reporting, so successful earlier steps are retained rather than attempting unsafe compensating rollback.
- Completed/failed attempts show a summary instead of a retry action, avoiding accidental repeated append/copy writes. A refresh failure is surfaced separately from the saved result.

## Files changed

Parser and persistence:

- `src/lib/mdImport/types.ts`, `parser.ts`, `sections.ts`, `matching.ts`, `store.ts`, `apply.ts`, `preview.ts`, `duplicate.ts`.
- `src/lib/mdImport/parser.test.js`, `matching.test.ts`, `apply.test.js`, `preview.test.ts`, `duplicate.test.js`, `wizard.test.ts`, `entryPoints.test.ts`.

Wizard and copy UI:

- `src/components/mdImport/FileDropArea.tsx`, `CompanyPreview.tsx`, `ProfilePreview.tsx`, `TemplatePreview.tsx`, `ImportPreviewCard.tsx`, `ImportSummary.tsx`, `ImportWizardView.tsx`, `ImportWizard.tsx`, `ImportSetupButton.tsx`.
- `src/components/emails/CopyTemplatesDialog.tsx`, `TemplateList.tsx`, `TemplateEditor.tsx`.
- `src/hooks/useTemplates.ts`, `src/hooks/useIcps.ts`, `src/pages/Settings.tsx`.

Local documentation: `docs/MD-IMPORT-BUILD-REPORT.md`, `docs/HANDOFF.md`, `docs/NEXT-STEPS.md`, `AGENTS.md`, `CLAUDE.md`.

## Not verified and next action

- Browser drag/drop, keyboard interaction, mobile layout, native file decoding and actual mounted interaction were not exercised. Component coverage uses real React server rendering plus pure selection/file-handling tests, not a browser DOM.
- Real Supabase queries, live RLS/column grants, storage access, network failures with uncertain commit outcomes, and concurrent users were not exercised. The in-memory PostgREST fake cannot prove those runtime properties.
- No independent review has occurred. Subscription allowance was not exposed; no percentage is asserted.
- No jobs remain running. Open this worktree, read this report, and have Claude review the application revision plus final documentation. Stop here; publication still requires Kevin's authorization.
