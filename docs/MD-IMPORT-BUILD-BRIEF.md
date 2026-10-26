# Build brief: MD setup import and template duplicate

You are Codex, the builder. Claude is the architect and reviewer. Kevin directs.

Work only in this worktree (`C:/Users/kevin/Projects/dreamlabs-sales-md-import`, branch `codex/md-import-build`). Do not touch any other checkout.

## Read first

1. `docs/superpowers/specs/2026-10-26-md-import-and-template-duplicate-design.md` (the approved design: follow it).
2. `docs/MD-IMPORT-FORMAT.md` (the file format contract; the parser must accept exactly this).
3. `CLAUDE.md` and `AGENTS.md` for project conventions.
4. Existing code to match in style: `src/hooks/useTemplates.ts`, `src/components/emails/TemplateList.tsx`, `src/components/emails/TemplateEditor.tsx`, `src/components/settings/IdealCustomerProfilesCard.tsx`, `src/components/settings/IcpEditor.tsx`, `src/components/settings/CompanyProfileCard.tsx`, `src/lib/templateVars.ts`, `src/pages/Settings.tsx`.

## Task

Build everything in the spec's Scope section:

1. Pure parser and matching logic in `src/lib/mdImport/` with tests written first.
2. The import wizard (file drop and choose button, per-type preview cards, tick boxes, add-new versus replace choice, apply summary) with entry points in Settings ("Import setup files", admin only) and on the Templates page ("Import templates", admin only).
3. Apply logic in the order company context, ICPs, templates, as in the spec.
4. Single-template Duplicate and "Copy templates to another ICP".
5. Before coding duplicate, read how template deletion treats stored attachment files and apply the spec's attachment rule. Record which case applies in the build report.

## Constraints

- No migration, no edge function, no new table, no new dependency unless unavoidable (then say why in the report).
- TDD: write each failing test first, see it fail, then implement. The test that extracts the three example code blocks from `docs/MD-IMPORT-FORMAT.md` and parses them must exist and pass.
- Never swallow errors with a bare `catch {}`; log with context.
- User-facing text: plain, short, no jargon. Components under about 150 lines where practical.
- Accessible and mobile-friendly as described in the spec.
- Do not change existing editors' behaviour, RLS, or the shared tests unless a test must be updated for a real reason; say so in the report.
- Do not call any external service. Do not push, merge, deploy, or write to any remote or to Supabase. No real credentials. No emails or messages.
- Use dummy environment values only for local test runs (for example `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY=local-test-placeholder`). Install with `npm ci --ignore-scripts` if dependencies are missing.
- Stage explicit file paths only. Commit in small logical commits with `git -c core.hooksPath=NUL commit` and end each message with `Co-Authored-By: Codex <noreply@openai.com>`.

## Gates (all must pass at the end)

`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`. Report exact counts.

## Deliver

Write `docs/MD-IMPORT-BUILD-REPORT.md`: what was built, files changed, gate results with counts, decisions you made where the spec was silent, anything not verified (browser behaviour, real Supabase), and the attachment-rule outcome. Then stop. Claude reviews before any merge.
