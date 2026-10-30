# Build brief: download the Dreamlabs Sales setup skill from Settings

Written 2026-10-30 by Claude (architect and reviewer). Builder: Codex, in this worktree `C:/Users/kevin/Projects/dreamlabs-sales-skilldl`, branch `codex/setup-skill-download`, based on `origin/main` `0937140`. Kevin approved this task, the zip format, member-wide visibility and Codex as builder (2026-10-30). Claude reviews afterwards. Do not push, merge, deploy or touch production. Commit locally with `git -c core.hooksPath=NUL` and end every commit message with `Co-Authored-By: Codex <noreply@openai.com>`. Stage explicit file paths only (CRLF/LF noise must never be committed). TODO item 32.

## Goal
On Settings, next to the "Import setup files" button, add a button "Download setup skill". It downloads one zip. Below the button, show simple instructions for people who are not technical. The skill (a chat assistant instruction set) interviews a business owner and writes the `.md` files that "Import setup files" accepts.

## Decisions by Kevin
1. One zip that holds both the Claude Code folder version and the single-file version for Claude.ai or ChatGPT.
2. The instructions are written for non-technical users: short numbered steps, everyday words, no jargon. They must be dummy-proof.
3. Every member of the organisation sees the button and instructions. Only admins can import the resulting files, so the instructions must say this in one plain sentence (for example: "Only an admin can upload the finished files. If you are not an admin, send the files to your admin.").
4. Codex builds, Claude reviews.

## Source material (read only, outside the repo)
`C:/Users/kevin/OneDrive/Desktop/DI Dreamlabs Context Brain/_Tools/Custom skills/dreamlabs-sales-setup/` holds skill v2 (2026-10-30):
- `SKILL.md` (Claude Code and Claude.ai folder version) and `references/` (`file-format.md`, `interview-guide.md`, `sequences.md`)
- `SKILL-single-file.md` (everything in one file, 29 KB)
- `chatgpt-instructions.md` (under 8,000 characters for the ChatGPT instructions box; its knowledge files are the three references)
- `README.md` (internal notes for Kevin; do NOT ship it)

Copy the shipped files into the repo as the source of truth, for example `setup-skill/` at the repo root (folder version under `setup-skill/claude-code/dreamlabs-sales-setup/`, plus `single-file/`, plus `chatgpt/`). Do not edit the skill text. If you find a mistake in it (for example a format rule that disagrees with `docs/MD-IMPORT-FORMAT.md` or the real parsers in `src/lib/mdImport/`), do not fix it silently: list it in the report for Claude and Kevin.

## Zip layout
File name `dreamlabs-sales-setup-skill.zip`. Contents:
- `START HERE.txt` — the same plain instructions as the Settings card, as text, so they travel with the file.
- `1 - Claude Desktop or Claude.ai/` — the folder version zipped for upload, or the single file, whichever the current Claude upload flow accepts. Check Claude's current documentation for how a custom skill is added (Claude Code: a folder under `~/.claude/skills/`; Claude.ai: Settings, Capabilities, Skills, upload a zip with `SKILL.md` at the folder root). Put in the zip what actually works and say which in the instructions. Do not guess: if you cannot confirm the exact menu names, write the step generically and flag it in the report.
- `2 - Claude Code (developers)/dreamlabs-sales-setup/` — `SKILL.md` and `references/`.
- `3 - ChatGPT/` — `chatgpt-instructions.md` and the three reference files as knowledge files.
- `4 - Any other chat (paste)/SKILL-single-file.md`.
Keep folder names short and plain. No internal vault paths, no secrets, no personal data anywhere in the zip.

## How the zip gets served
The app is Vite plus Cloudflare Workers static assets (`wrangler.jsonc`, `assets.directory ./dist`, SPA fallback). The `public/` folder does not exist yet; create it. Serve the zip as a static file at `/downloads/dreamlabs-sales-setup-skill.zip` and link it with the `download` attribute. Make sure the SPA fallback does not swallow the path (verify with the built `dist/`). Preferred approach: a script `scripts/build-setup-skill-zip.mjs` builds the zip from `setup-skill/` into `public/downloads/`, and a unit test fails if the committed zip is out of date with its sources (rebuild in memory, compare entry names and bytes). If you need a zip library, a small MIT one such as `fflate` is acceptable as a devDependency; name it in the report. Do not add anything larger. Keep the zip well under 1 MB. If you prefer running the script in `prebuild`, say why in the report; committing the generated zip is the simpler, safer default because the Cloudflare build then needs no extra step.

## UI
- File: `src/pages/Settings.tsx`, the "Import setup files" card (currently admin-only, `currentOrg?.role === 'admin'`). Do not make the import button visible to non-admins. Add a separate card, visible to every member, titled "Setup skill" (or put both in one card but keep the import button admin-only; your call, state it in the report).
- The download button sits next to the import button where both show (admin), and appears alone for other members.
- Instructions below the buttons, plain words, numbered. Suggested content (refine the wording, keep it this simple):
  1. Click "Download setup skill". Save the zip, then open it (right-click, Extract all).
  2. Open the folder that matches the chat tool you use. Not sure? Use Claude (folder 1).
  3. Add the skill to your chat tool (one short step per tool, taken from the zip's START HERE file).
  4. Start a new chat and say: "Help me set up Dreamlabs Sales for my business." Answer its questions in your own words.
  5. When it is finished it gives you several files ending in `.md`. Save each one.
  6. Admins: click "Import setup files", choose all the files at once, check the preview, then save. Not an admin? Send the files to your admin.
  7. Reload the page after importing to see everything. Turn each imported sequence on yourself when you are happy with it (they start switched off).
  Add a short "Something went wrong?" line: wrong file type error means hard refresh (Ctrl+F5) and try again; ask the admin if the import button is missing.
- Follow the repo's UI rules: existing `Button`/`Card` components, Tailwind tokens, light and dark themes, keyboard focus, visible focus ring, text contrast per the existing tokens, works at 400 px width. The instruction block must be readable without scrolling sideways. Use real `<ol>` markup.
- Do not add dependencies for the UI.

## Tests (write first)
- Component: the download link points to `/downloads/dreamlabs-sales-setup-skill.zip` and has the `download` attribute; it renders for a non-admin member and for an admin; the import button still renders for admins only; the instructions render as an ordered list with the admin-only sentence.
- Zip: contains the expected entry names; no entry contains `README.md`, no absolute paths, no `C:\`, no vault paths, no secrets patterns (reuse any existing secret-scan test helper if the repo has one, else a simple regex for `sk-`, `eyJ`, `SUPABASE`, `password`); up to date with `setup-skill/` sources; size under 1 MB.
- Built output: after `npm run build`, `dist/downloads/dreamlabs-sales-setup-skill.zip` exists.
- Existing `src/lib/mdImport/entryPoints.test.ts` still passes.

## Gates (run one at a time, report the numbers)
`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs`, with env `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-test-placeholder`. Frontend only: no migration, no edge function.

## Out of scope
Changing the skill text, the importer, or any migration. Hosting the skill anywhere else. Auto-updating the zip when the vault skill changes (list "how to refresh the zip" as a short section in the report: copy new files into `setup-skill/`, run the script, commit).

## Report
Write `docs/SETUP-SKILL-DOWNLOAD-BUILD-REPORT.md`: what changed, files, tests, gate numbers, the exact Claude upload steps you confirmed or could not confirm, any skill-text mismatches found, the dependency (if any), and the rollout (frontend only, push to `main` auto-deploys in about 90 seconds; verify by fetching the zip from the live site). Commit the report last. Stop after the report.
