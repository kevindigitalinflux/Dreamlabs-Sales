# MD setup import and template duplication — design

Status: DRAFT for Kevin's approval (2026-10-26). Builder: Codex in its own worktree. Reviewer: Claude.

## Goal

A new organisation can be set up in minutes: upload up to three Markdown files (company context, ICP profiles, email templates) produced by a Claude skill, review a preview, and save. Separately, any email template can be duplicated in one click, and a whole set of templates can be copied from one ICP to another.

The file format is fixed in `docs/MD-IMPORT-FORMAT.md`. That file is the contract: the Claude skill is built from it and the parser is tested against it.

## Decisions (Kevin, 2026-10-26)

1. Import shows a preview first, then the user chooses per file whether to add as new or replace existing matches. Nothing is saved before that choice.
2. Claude writes the format spec (done, `docs/MD-IMPORT-FORMAT.md`). The parser is strict and deterministic. No AI call on upload, so no AI cost and no misreading.
3. Duplicate works two ways: copy one template, and copy a whole ICP's template set to another ICP.
4. Codex builds, Claude reviews. Role defaults, no change.

## Scope

In scope:

- One import wizard that accepts one or more `.md` files at once and identifies each by its `type:` front matter.
- Entry points: Settings (a card "Import setup files") and the Templates page (button "Import templates", opens the same wizard).
- Parser, preview, apply for the three types.
- Single-template duplicate and ICP-set copy.

Out of scope for this build: exporting current data back to Markdown (worth adding later for round trips), importing attachments, importing sequences, importing leads, any AI processing of the files.

## No new infrastructure

No migration, no edge function, no new table. The wizard writes through the existing Supabase client under the existing row-level security, exactly as the current editors do. If a write is refused by RLS the user sees a plain message and nothing partial is left (see Apply).

Permissions follow the existing editors:

- Company context and ICP profiles: org admins only (existing RLS: `organizations_admin_update_context`, `icp_admin_*`).
- The import wizard is therefore admin-only. Non-admins do not see the Settings card or the Import button.
- Duplicate: anyone who can create templates today (org members). Copying a set to another ICP: same.

## Parser (`src/lib/mdImport/`, pure TypeScript, no I/O)

- `parseSetupFile(text, filename)` returns `{ type, data, errors[], warnings[] }`.
- Checks the limits in the format doc: 200 KB per file, 8,000 characters of company context, 50 profiles, 100 templates, 80-character names, 3,000 characters per section. Longer values are errors, never silently truncated.
- Normalises line endings, strips a UTF-8 BOM, trims whitespace.
- Errors carry the line number and a short reason (for example "line 14: unknown section '## Pain point', did you mean '## Pain points'?"). A file with any error cannot be imported, and the wizard says which file and line.
- Warnings do not block: unknown placeholder, missing `{{unsubscribe_url}}`, template ICP that does not exist yet.
- Treats all text as plain text. No HTML is interpreted. Email bodies are stored exactly as typed, the same way the editor stores them today.
- Placeholder checking uses the existing placeholder list in `src/lib/templateVars.ts` plus the organisation's custom placeholders.

## Preview

For every file the wizard shows a card with: file name, detected type, counts, errors (blocking, in red) and warnings.

- Company context: shows the current text (or "empty") beside the new text, and the choice "Replace" or "Append below the existing text". Default Replace when empty, Append when not empty.
- ICP profiles: a row per profile with a tag "New" or "Matches existing: &lt;name&gt;" (case-insensitive name match, the same rule as the unique index). Choice for the file: "Add new only, skip matches" or "Add new and replace matches". Default skips matches.
- Email templates: a row per template with its ICP and category and a tag "New" or "Matches existing template of the same name in the same ICP". Same two choices. Row with an ICP that cannot be resolved: tag "ICP not found", unticked by default, with a tick box to import it without an ICP.
- Each row has a tick box so the user can drop individual items.
- A single "Import" button, disabled while any file has a blocking error. A file with errors can be removed from the batch without losing the others.

## Apply

Order is fixed: company context, then ICP profiles, then email templates, so templates can attach to profiles created in the same batch.

- ICP profiles: one `upsert` on `(org_id, lower(name))`-equivalent logic. Because the unique index is on `lower(name)`, the code looks up existing ids by lower-cased name first, then does one `insert` for new rows and `update` calls for replaced ones. The ICP set is small (50 max).
- Templates: matched by lower-cased name within the same `icp_id`. New rows are one bulk `insert` with `template_type: 'custom'`, `created_by` the current user, `org_id` the current org, `is_default: false`. Replaced rows update `subject`, `body`, `category`, `icp_id` and `links`, and never touch `is_default` or `attachments`.
- If a step fails the wizard stops, reports what was saved so far and what was not, and does not retry silently. Re-running the same import is safe: already-saved items now match and are skipped under the default choice.
- Every failure is logged to the console with context (no bare empty catch).
- After success the wizard lists exactly what was created and updated, and refreshes the lists.

## Duplicate

- Single template: a "Duplicate" action on each template card and in the editor. Creates a copy named `Copy of <name>` (adds ` (2)`, ` (3)` if that name is taken in the same ICP), same subject, body, category, ICP and links, `is_default: false`, owned by the current user in the current org. Duplicating a default or shared template yields an org-owned copy. The editor opens on the copy.
- Attachments: copying them means two templates point at the same stored file. The builder must first read how template deletion treats stored files. If deleting a template deletes its stored files, the copy does not carry attachments and the duplicate dialog tells the user "attachments are not copied, add them again". If deletion leaves files alone, attachments are copied by reference. The builder records which case applies in the build report.
- ICP set copy: on the Templates page, "Copy templates to another ICP". Pick a source ICP, a target ICP, tick the templates (all ticked by default), confirm. Copies are named `<name> — <target ICP name>`, keep category, subject, body and links, get `icp_id` of the target, `is_default: false`. A preview shows the new names before saving.

## UI details

- Follow the existing component set (`Button`, `EmptyState`, `Skeleton`, `CategoryBadge`). Components stay small: the wizard is split into a file drop area, one preview card per type, and an apply summary.
- Accessible: the drop area is also a normal "Choose files" button, results are announced with `role="status"`, errors use `role="alert"`.
- Mobile: single column, tick boxes at least 44 px tall.
- Wording is plain and short. No jargon in user-facing text.

## Tests (written first)

- Parser: a valid fixture for each type produces the exact expected data. Fixtures are the three examples in the format doc, kept in sync by a test that extracts the code blocks from `docs/MD-IMPORT-FORMAT.md` and parses them.
- Parser errors: missing front matter, unknown `type`, missing required section, duplicate ICP name, unknown section heading, over-limit sizes, non-https link, binary or empty file, CRLF and BOM input.
- Placeholders: unknown and missing-unsubscribe warnings.
- Preview matching: case-insensitive name matches, template matched within the same ICP only, unresolved ICP.
- Apply logic against a fake Supabase client: order of operations, add-only versus replace, partial failure report, `is_default` and `attachments` never overwritten, re-running the same import changes nothing.
- Duplicate: name collision suffixes, default template copy becomes org-owned, set copy naming.
- Component tests for the wizard states: empty, file with errors, valid preview, success, failure.
- Full gates must pass: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

## Security and privacy

- Files are read in the browser and never uploaded as files. Only the parsed text fields are saved, under RLS.
- Content is stored as plain text and rendered as text. Nothing from a file is ever inserted as HTML.
- Admin-only for the data that feeds AI prompts, as today. The format doc tells the skill author not to include secrets or personal data.
- The Settings copy states that the content feeds the AI drafting step.

## Rollout

No migration and no function deploy. Merge to `main` after review and Kevin's yes, Cloudflare deploys the front end. Live check on DI Dreamlabs: upload the three example files from the format doc, confirm the preview, import, confirm profiles, templates and context appear, then run the same import again and confirm nothing is duplicated.

## Build order

This is independent of Places and platform-owners (both shipped). It goes before the phone-numbers build unless Kevin says otherwise.
