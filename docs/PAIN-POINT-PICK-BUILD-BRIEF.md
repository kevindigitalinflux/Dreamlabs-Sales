# Build brief: AI picks the best pain point per lead (tailored AI drafts)

You are Codex, the builder. Claude is the architect and reviewer. Kevin directs. Status: DRAFT, awaiting Kevin's approval to build. Do not start until Claude confirms approval in the task message.

Worktree: create `git worktree add ../dreamlabs-sales-painpoint -b codex/pain-point-pick origin/main` from `C:/Users/kevin/Projects/dreamlabs-sales-picker`, run `npm ci`, work only there.

## Why
A customer profile (ICP) lists several pain points, one per line. Today the platform uses only the first one as the `{{pain_point}}` default, and nothing chooses a better one per lead. Kevin's cleaning sequences have several real angles (lost contracts and transparency, cleaner recruitment and cover, paperwork and admin). For tailored AI drafts the platform should pick the angle most likely to land for each lead, show what it chose and why, and let the rep change it before anything sends.

## Decisions already made by Kevin (2026-10-29)
1. The AI may choose from the saved ICP pain-point list, or propose a new angle when none fits.
2. The chosen pain point and a one-line reason must be visible on the lead and on the review screen.
3. Scope for this build: tailored AI drafts only. Template sequences keep `{{pain_point}}` exactly as today (the lead's own noted pain point first, else the ICP's first line). Do not change template filling.
4. Phase 2 (NOT in this build): the AI picks which angle-specific template to use per lead.
5. Review-before-send is unchanged. Nothing new sends without review.

## Read first
`CLAUDE.md`, `AGENTS.md`, `supabase/functions/_shared/icp.ts` (`topPainPoint`, `formatIcpContext`), `supabase/functions/_shared/ai.ts` (`generateLeadNotes`, the draft prompts that mention the ICP), `supabase/functions/_shared/templateVars.ts` (how `pain_point` is filled), `supabase/functions/generate-email/index.ts`, `supabase/functions/check-sequences/index.ts`, `supabase/functions/run-selected-autopilot` and `run-autopilot` (where AI drafts are made), the lead notes format (`Main pain point:` note lines), and the Autopilot review screens.

## Today (verified by Claude)
- `{{pain_point}}` = the lead's own note line `Main pain point:` first, else `topPainPoint(icp)` (first ICP line).
- The notes pass (`generateLeadNotes`) is told to use the ICP to choose a pain point, but its output is free text in the "ai_summary" note. Nothing stores a structured chosen pain point, and nothing explains the choice.

## What to build
1. **Pure picker module with tests first.** Parse ICP pain points into a clean list (reuse the existing line/bullet stripping). Define the structured result: `{ pain_point: string, source: 'icp_list' | 'proposed', reason: string }`. Validation rules: non-empty, trimmed, bounded length, reason bounded, no AI punctuation per the existing `stripAiPunctuation` rule, `source` must match whether the text equals a list item (case and spacing insensitive).
2. **AI step.** Extend the existing notes-then-draft flow (do not add a second model call per lead if the notes call can return it). The notes call returns the chosen pain point and reason as structured output alongside the talking points. Prompt rules: choose from the list unless none genuinely fits, say why in one plain sentence using only facts in the lead data, never invent facts, fall back to the first list item when the data gives no signal. Model split stays as is (Sonnet for notes, Haiku for drafts).
3. **Storage.** Store the chosen pain point and reason on the lead in the way that needs the least schema change. Prefer the existing notes mechanism (a clearly formatted note line the existing `Main pain point:` reader already understands, plus a separate reason line) so `{{pain_point}}` consistently picks it up. If a column or migration is genuinely needed, STOP that item and record why and the exact SQL for Claude to review; do not apply anything.
4. **Precedence.** A pain point the rep typed by hand always wins over an AI pick, and an AI pick never overwrites a manual one. Re-running the notes pass must not silently replace a manual choice. Record the rule in the report.
5. **Use in drafts.** The tailored AI draft prompt receives the chosen pain point and reason and must build the email around it. Template sequences are untouched.
6. **Visibility and edit.** Show "Pain point: X (chosen by AI because Y)" on the lead panel and in the Autopilot/Emails review screen, with a way to change it (pick another from the ICP list or type your own) before sending. Changing it marks it as manual. Plain UK English, real buttons, labelled controls, phone width, both themes, loading and error states.
7. **Readiness/eligibility** logic must not change.

## Constraints
- TDD: failing test first for the pure logic and any prompt-output parsing. Handle malformed AI output safely (fall back to the first list item, log with context, never log lead text or secrets, no bare `catch {}`).
- No change to caps, review-before-send, eligibility, RLS or grants. No new dependency. No external service calls in tests. No push, merge, deploy, or Supabase writes. No real credentials, mail or messages.
- Stage explicit paths only. Small commits with `git -c core.hooksPath=NUL commit`, each ending with `Co-Authored-By: Codex <noreply@openai.com>`. Do not add a new checkpoint block at the top of `AGENTS.md`, `CLAUDE.md` or `docs/HANDOFF.md`; add one short dated section in `docs/HANDOFF.md` only.

## Gates
`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs`. Record the baseline first (expected 190 files / 2,705 tests) and report exact counts. Use dummy env `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-test-placeholder`.

## Deliver
`docs/PAIN-POINT-PICK-BUILD-REPORT.md`: what was built, files changed, the storage choice and why, the precedence rule, the prompt change, gate counts, decisions where this brief was silent, what was not verified (Deno runtime, a real AI call, browser, phone width, themes), and the exact edge functions to deploy and the safe order. Then stop. Claude reviews before any merge.
