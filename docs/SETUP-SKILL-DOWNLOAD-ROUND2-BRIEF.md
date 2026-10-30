# Round 2 brief: visual hierarchy and scannability of the Setup skill card

Written 2026-10-30 by Claude (reviewer). Builder: Codex, same worktree `C:/Users/kevin/Projects/dreamlabs-sales-skilldl`, branch `codex/setup-skill-download`, continuing from `c1ee2d1`. Kevin asked for this change (2026-10-30). Same rules as the first brief: no push, merge or deploy; commit locally with `git -c core.hooksPath=NUL`, end messages with `Co-Authored-By: Codex <noreply@openai.com>`; stage explicit paths; one gate at a time. Update `docs/SETUP-SKILL-DOWNLOAD-BUILD-REPORT.md` with a "Round 2" section and commit it last.

## Problem found in review
In the Settings card, step 3 is one dense block: the four tool options (Claude Desktop or Claude.ai, Claude Code, ChatGPT, any other chat) sit on consecutive lines with no spacing or labels that stand out. A non-technical reader cannot scan it. Kevin's goal: the best visual hierarchy and scannability possible for non-technical users.

## What to build
Redesign the instruction block so a reader can find their path in seconds. Keep everything dummy-proof and in everyday words. Suggested design (you may improve it, but keep the intent, and record the choices in the report):

1. **Clear action hierarchy.** "Download setup skill" is the primary button (filled, brand colour, existing primary Button style). "Import setup files" (admins only) is secondary, visually quieter, and sits beside it. A one-line summary under the title says what the skill does.
2. **Numbered steps with short bold titles.** Each step: a bold title of 2 to 4 words ("Download", "Open the folder", "Add the skill", "Answer the questions", "Save your files", "Import them", "Switch sequences on"), then one or two short sentences. Maximum about 15 words per sentence. One idea per sentence. Real `<ol>` markup, visible numbers, generous spacing between steps.
3. **Step 3 becomes a choice, not a wall.** Four labelled options, each its own block with a heading and its own short numbered sub-steps (three or four lines at most):
   - "Claude Desktop or Claude.ai" is shown first and marked "Recommended" (a small badge). It is the default path.
   - "Claude Code (developers)", "ChatGPT" and "Any other chat (paste)" follow. Use native `<details>`/`<summary>` for the three less common options so they start collapsed, keyboard accessible, with a visible focus ring and no JavaScript. The recommended option starts open.
   - Put the folder name next to each option ("folder 1", "folder 2", "folder 3", "folder 4") so it matches the zip.
   - File names and menu words in bold or inline code style so they stand out (for example **Customize**, **Skills**, `dreamlabs-sales-setup.zip`).
4. **Admin-only step marked.** Step "Import them" shows a small "Admins only" badge, and the sentence for members ("Not an admin? Send the files to your admin.") stays in plain words. Members still see the step.
5. **Troubleshooting as a callout**, visually separate from the steps (border or tinted background using existing tokens), with the two existing tips.
6. **Layout and accessibility.** Existing tokens only; both themes; text contrast at least as good as today (no new low-contrast muted text for instructions); visible focus rings; works at 400 px with no sideways scroll; touch targets at least 44 px; respects reduced motion; no new dependency. Headings in logical order (the card title is the h2; option titles are not headings above that level). Do not hide information behind hover.
7. **One source of truth.** The card and the zip's `START HERE.txt` must still carry the same instructions. If the new structure cannot be read from a single plain text file, create one small structured source (for example a typed constant or JSON under `setup-skill/`) and generate both the card and `START HERE.txt` from it; keep the parity test, extended to cover the new structure. The text file in the zip must stay readable in Windows Notepad: blank lines between steps and options, option names in capitals or with dashes, no Markdown syntax, no HTML.
8. **Wording unchanged in meaning.** Do not change the Claude upload menu path, the folder structure of the zip or the skill files. Do not claim any step was tested in a real account. Rebuild the zip with `node scripts/build-setup-skill-zip.mjs` only because `START HERE.txt` changes, and keep the build deterministic.

## Tests (write first)
- The card renders four option blocks; the Claude Desktop or Claude.ai option is first, labelled Recommended and open; the other three use `<details>` and start closed.
- Each step has a bold title; the steps are an ordered list of seven items; the "Admins only" badge appears on the import step; the member sentence is present for everyone.
- Primary versus secondary button styling: the download link has the primary class set; the import button keeps its existing checks and stays admin-only.
- Parity: the card text and `START HERE.txt` come from the same source and agree on every step title, option name, file name and menu word.
- The zip is rebuilt and the freshness, layout, size and safety tests still pass; `START HERE.txt` has no Markdown or HTML tokens and is under 4 KB.
- Existing Settings and import entry-point tests still pass.

## Gates and report
`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs`, with `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-test-placeholder`. Add a short Round 2 section to the report: design choices, files, gate numbers, new zip size and SHA-256, and anything not verified (browser, real upload). Stop after the report.
