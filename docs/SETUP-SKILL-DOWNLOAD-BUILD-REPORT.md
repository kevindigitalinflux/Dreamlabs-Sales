# Setup skill download build report

Date: 2026-10-30. Worktree: `C:/Users/kevin/Projects/dreamlabs-sales-skilldl`. Branch: `codex/setup-skill-download`. Kevin directs; Codex builds; Claude remains architect and reviewer. Independent review is pending.

Built the approved `docs/SETUP-SKILL-DOWNLOAD-BUILD-BRIEF.md` from starting revision `8a1a580` (brief on top of `0937140`). Implementation commits:

- `dfe226c`: reproducible archive, supplied sources, archive tests and dependency.
- `31e9e22e020f241a0ce9ab984ecb393e2eafad03`: member-visible Settings card, component tests and checkout handoff pointers.

This report is committed separately, last. No push, merge, deployment, database access, migration, edge-function change, other-checkout edit or vault write occurred. Documentation lookups and npm dependency downloads were the only external services used. Subscription usage is not exposed to this session.

## What changed

Settings has one combined **Setup skill** card, visible whenever an organisation is selected. Every member sees **Download setup skill**. Admins also see the existing **Import setup files** button next to it; that component retains its own admin and authenticated-session checks. Its existing post-import refresh callback is preserved. No importer code or permissions changed.

The download is a same-origin anchor with `download="dreamlabs-sales-setup-skill.zip"`, pointing at `/downloads/dreamlabs-sales-setup-skill.zip`. The card uses the existing Card and import Button, existing theme tokens, a visible keyboard-focus outline, a wrapping button row and wrapping instruction text. Seven real ordered-list items explain installation, the interview and importing; an explicit sentence tells members to send the finished files to their admin. Troubleshooting includes Ctrl+F5 and asking the admin about a missing import button. The seven items and troubleshooting paragraph come directly from `setup-skill/START HERE.txt`, so the card and archive carry the same instructions.

All six supplied skill files were copied without changing any bytes. The internal README was excluded. `.gitattributes` preserves the shipped source bytes across Git checkouts, including supplied line endings. Neither the source vault nor its skill registration was changed.

The committed archive is **52,645 bytes**, well below 1 MB. SHA-256:

`701e0a1f28e0c4f98c7f983d4538dd969a3f396f0f95c307d8dd152a600e050a`

Its layout is:

```text
START HERE.txt
1 - Claude Desktop or Claude.ai/
  dreamlabs-sales-setup.zip
2 - Claude Code (developers)/
  dreamlabs-sales-setup/
    SKILL.md
    references/file-format.md
    references/interview-guide.md
    references/sequences.md
3 - ChatGPT/
  chatgpt-instructions.md
  file-format.md
  interview-guide.md
  sequences.md
4 - Any other chat (paste)/
  SKILL-single-file.md
```

The inner Claude upload zip contains `dreamlabs-sales-setup/SKILL.md` and its three `references/` files. Users extract the outer download, then upload the inner zip intact. It is the same folder content provided for Claude Code.

## Files and dependency

- `src/pages/Settings.tsx`: replaces the old admin-only import card with the combined member-visible card.
- `src/components/settings/SetupSkillCard.tsx`: download link, guarded import entry point and shared instructions.
- `src/pages/Settings.test.ts`: Settings rendering for members/admins and instruction parity.
- `setup-skill/START HERE.txt`: the shared user instructions.
- `setup-skill/claude-code/dreamlabs-sales-setup/SKILL.md` and the three `references/` files: unchanged folder-version sources.
- `setup-skill/chatgpt/chatgpt-instructions.md`: unchanged ChatGPT instructions. The builder reuses the three canonical reference files for ChatGPT Knowledge rather than maintaining duplicate source copies.
- `setup-skill/single-file/SKILL-single-file.md`: unchanged paste version.
- `scripts/build-setup-skill-zip.mjs`: explicit file allowlist, fixed ZIP timestamps, in-memory builder and local CLI writer.
- `public/downloads/dreamlabs-sales-setup-skill.zip`: committed generated download.
- `src/lib/setupSkillDownload.test.js`: archive layout, nested archive, source-byte parity, freshness, safety patterns, size and built-output checks.
- `.gitattributes`, `package.json`, `package-lock.json`: byte preservation and dependency registration.
- `CLAUDE.md`, `docs/HANDOFF.md`, `docs/NEXT-STEPS.md`: current checkout checkpoint and TODO 32, left pending independent review.
- This report.

Added **fflate 0.8.3**, MIT, as an exact devDependency. No UI dependency or browser compression code was added. The script is manual; there is no prebuild step. Committing the archive keeps the Cloudflare build unchanged. Installation reports eight existing dependency advisories (two moderate, six high); no broad dependency updates were attempted. The final fflate version has no advisory in that audit.

## Tests and gates

Tests were written before implementation. Initial targeted run: **six failures**, caused by the missing member/admin link, missing shared instructions and missing committed archive. One built-output check initially returned before a build existed; it was changed to an explicit conditional skip. Initial TypeScript gate then caught a Node filesystem import in the frontend TypeScript test. Replaced that import with Vite's raw-text import; no compiler configuration or extra type dependency was needed.

All five gates ran **one at a time**, with:

```text
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=local-test-placeholder
```

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS, zero diagnostics after the test-import correction |
| `npx vitest run` | PASS, 201 files, 2,787 passed, zero failed, one conditional built-output test skipped before dist existed |
| `npm run build` | PASS, 2,940 modules, existing warning about chunks over 500 kB |
| `git diff --check` | PASS; staged whitespace checks also passed before each implementation commit |
| `node scripts/places-edge-typecheck.mjs` | PASS, 25 entrypoints; local TypeScript shim, not a Deno runtime check |

After the build, the targeted Settings/archive/import-entry-point run passed **10 tests, zero failures, zero skips**, including the previously skipped built-output check. The seven new tests cover the member/admin download, admin-only import button, download attribute and URL, ordered instructions and admin sentence, instruction parity, exact outer/inner entry names, matching inner/Code payloads, unchanged source bytes, stale-archive detection, unsafe path/credential patterns, size and exact built ZIP bytes. Existing `src/lib/mdImport/entryPoints.test.ts` passed unchanged.

Additional verification:

- Compared all six copied files against the supplied vault files: byte-identical.
- Verified both `public/downloads/` and built `dist/downloads/` contain the same ZIP bytes.
- Served dist with local Vite preview. Fetching the exact download path returned **HTTP 200**, **application/zip**, **52,645 bytes**, with the SHA-256 above. It returned the archive rather than SPA HTML. Existing Wrangler configuration serves `./dist` with SPA fallback; no routing configuration changed. Cloudflare's live runtime was not contacted.
- Scanned outer and inner entry names for absolute/traversal paths and README; scanned extracted text for vault/local paths and credential-shaped `sk-`, `eyJ`, Supabase assignment and password assignment patterns. All passed. The password pattern deliberately matches assignments, because the unchanged skill includes instructions never to share passwords.

Authenticated browser testing, actual Claude/ChatGPT uploads, 400 px visual inspection and light/dark visual inspection remain unverified. The layout uses normal wrapping text and real list markup; no claim of an interactive browser or accessibility audit is made. Local preview was stopped before writing this report.

## Confirmed tool instructions

Checked official documentation on 2026-10-30. These are documentation-confirmed steps, not an authenticated upload test.

**Claude Desktop / Claude.ai:** The current [Claude Help Center upload guide](https://support.claude.com/en/articles/12512180-use-skills-in-claude) says to enable code execution/file creation under Settings → Capabilities (the updated label may be Create and edit files), then open **Customize → Skills → + → Create skill → Upload a skill**, upload the ZIP and enable it. Team/Enterprise controls can restrict uploads. The [custom-skill packaging guide](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills) requires a ZIP whose root contains the named skill folder, with SKILL.md and resources inside. Therefore folder 1 ships an upload-ready inner ZIP, not a bare Markdown file. This differs from the older Settings → Capabilities → Skills upload wording in the brief; the shared instructions follow the current help guide. If controls are unavailable, instructions offer the paste version or the user's Claude account admin.

**Claude Code:** [Official Claude Code skill documentation](https://code.claude.com/docs/en/skills) confirms personal skills under `~/.claude/skills/<skill-name>/SKILL.md`. Folder 2 supplies the complete named folder for that location.

**ChatGPT:** [OpenAI's GPT configuration guide](https://help.openai.com/en/articles/8554397-creating-and-editing-gpts) describes Instructions and uploaded Knowledge files, but says creation availability depends on the account/workspace and new personal GPT creation is unavailable. The instructions therefore say **if** the user can create or edit a GPT, paste the provided instructions and add the three Knowledge files. Otherwise, use folder 4 in an ordinary new chat. No new plugin format or installation was invented.

## Skill-text discrepancies for Claude and Kevin

The brief forbids editing the supplied skill text. These issues are recorded for review; every shipped source remains unchanged:

1. SKILL.md delivery guidance, the single-file version, ChatGPT instructions, sequence reference and the file-format reference's added house conventions broadly say sequences arrive switched off. That is true for **new** sequences only. The real importer and the main sequence section of the supplied reference correctly preserve an existing sequence's activation when replacing it. START HERE and Settings explicitly distinguish new imports from replacements.
2. The skill checklist and format reference omit some parser limits for templates: `parser.ts` caps all record names, including template names, at 80 characters; `sections.ts` caps a template subject and body at 3,000 characters each. The instruction set can therefore approve a file that the parser rejects if those limits are exceeded. Typical suggested email lengths are much shorter, but the omissions remain.
3. The checklist says package labels are saved exactly as typed. `extendedSections.ts` trims and collapses whitespace; the main company-packages section in the supplied format reference correctly describes that normalization. This is a wording inconsistency, not a change made by this build.

The supplied file-format reference includes extra house conventions beyond the repository format document. Those additions were retained, including the inconsistencies above. Importer, format contract, migration and automation behavior were not changed.

## How to refresh the zip

1. Copy approved new skill files into the corresponding `setup-skill/` paths. Do not copy the internal README. Keep references in the canonical Claude Code folder; the script also places them into ChatGPT's folder.
2. If installation guidance changes, update `setup-skill/START HERE.txt`; Settings reads the same file.
3. Run `node scripts/build-setup-skill-zip.mjs`.
4. Run the archive/component tests, build, then rerun the archive test so its built-output check executes. Review and commit explicit source and ZIP paths together.

No watcher or automatic vault synchronization was added.

## Rollout and handoff

Frontend only. There is no new migration, edge function, environment variable, database operation or automation. After Claude reviews and Kevin separately authorizes publication, pushing the accepted change to `main` triggers the existing deployment (the brief estimates about 90 seconds). No publication was attempted here.

After deployment, fetch `https://sales.didreamlabs.com/downloads/dreamlabs-sales-setup-skill.zip` and verify HTTP 200, a ZIP response rather than HTML, and the archive's contents/hash. Verify the download and numbered help for an admin and a member, confirm only the admin sees Import setup files, and check keyboard focus, both themes and 400 px width. Test the inner Claude ZIP upload in an authorized account. Review the recorded skill-text issues before deciding whether a separately approved skill revision is needed.

Builder stopped after this report. Next action: Claude reviews these commits and this report. No automatic follow-on work is authorized.

## Round 2 — hierarchy and scannability (2026-10-30)

Built `docs/SETUP-SKILL-DOWNLOAD-ROUND2-BRIEF.md` on the same branch, starting at `9f2498e` (Round 2 brief on top of `c1ee2d1`). Implementation commits: `856e762` (shared instructions and generated archive) and `ecd0b669ff1112899b5d110fcc7a18207be3ef29` (card hierarchy and Settings tests). This section is committed last. Claude's independent review remains pending.

The download is now first and uses the existing primary Button colour classes. The admin-only import remains secondary beside it, with wrapping on narrow screens. A short summary precedes seven numbered steps with bold titles and greater spacing. Four separately labelled native details/summary blocks show folder numbers and numbered installation sub-steps: recommended Claude starts open; the other three start closed. Native disclosure needs no JavaScript state. Menu labels are bold; file names use inline code. The import step carries an Admins only badge and the member handoff sentence. Troubleshooting is a separate bordered callout. Instructions use the normal text token, not muted text; summaries and actions have 44 px minimum targets and visible focus styles. Existing reduced-motion handling remains.

`setup-skill/instructions.json` is now the single instruction source. The card renders it directly; the existing zip builder generates both `setup-skill/START HERE.txt` and its archive entry. The text uses CRLF, capitals for option names and blank lines between blocks, with no HTML or Markdown formatting. It is **2,118 bytes**, below 4 KB. A focused `.gitattributes` rule recognizes its deliberate CRLF for whitespace checks. This supersedes the earlier refresh guidance: **edit instructions.json, then run `node scripts/build-setup-skill-zip.mjs`; do not edit the generated text directly.** No dependency was added.

Changed files: `.gitattributes`, `setup-skill/instructions.json`, `setup-skill/START HERE.txt`, `scripts/build-setup-skill-zip.mjs`, `public/downloads/dreamlabs-sales-setup-skill.zip`, `src/components/settings/SetupSkillCard.tsx`, `src/pages/Settings.test.ts`, `src/lib/setupSkillDownload.test.js`, and this report.

Tests were adjusted first; the initial run produced five expected failures for the absent primary styling, structured steps, option blocks and generated text. Final tests cover seven bold titles, four labelled choices and initial disclosure states, numbered option steps, focus/target classes, the admin badge/member sentence, primary versus secondary styling, unchanged admin gating, and portable-text parity for every generated instruction line. Archive freshness, layout, safety and size tests remain green. The built-output check now explicitly uses `CHECK_BUILT_ASSETS=1`, avoiding accidental comparison against an older dist during the pre-build suite.

Five gates ran one at a time with the same local placeholder environment documented above:

| Gate | Round 2 result |
|---|---|
| `npx tsc --noEmit` | PASS, zero diagnostics |
| `npx vitest run` | PASS, 201 files, 2,789 passed, zero failed, one post-build check explicitly skipped |
| `npm run build` | PASS, 2,940 modules; existing large-chunk warning |
| `git diff --check` | PASS after recognizing generated CRLF; staged checks also passed |
| `node scripts/places-edge-typecheck.mjs` | PASS, 25 entrypoints; TypeScript shim, not Deno |

After building, Settings, archive and existing importer entry-point tests passed **12 tests, zero failures, zero skips**, with `CHECK_BUILT_ASSETS=1`. The committed archive equals an in-memory rebuild byte-for-byte and equals the built dist archive. All **10 other archive entries**, including the nested Claude upload zip, remain byte-identical to Round 1; only START HERE changed. The supplied skill files, Claude menu path, download URL and folder layout are unchanged.

New ZIP: **52,601 bytes**. SHA-256: `f6f86487bffbcbbafd8ebd6577d6a58dd4354b97ba01ce712f2500f95c4794a3`.

Browser interaction, 400 px overflow, keyboard operation, light/dark appearance and real-account uploads were not exercised. Markup and class assertions do not replace those checks. No claim of a real upload test is made; the earlier documentation-confirmed menu path remains the basis for the instructions. The original skill-text discrepancies still require Claude and Kevin's review. No push, merge, deployment, database access, migration, external call, vault edit or other-checkout edit occurred in Round 2. Builder stops after this report update.
