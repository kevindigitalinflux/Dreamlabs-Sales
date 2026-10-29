# Tailored AI pain-point pick — build report

2026-10-29. Codex is builder and sole writer; Claude remains architect/reviewer. Kevin's explicit approval in the task message supersedes the brief's DRAFT banner. Independent review is pending.

## Worktree and commits

The first command was the authorised `git fetch origin`. Read the brief with `git show origin/main:docs/PAIN-POINT-PICK-BUILD-BRIEF.md`, then created the specified worktree with `git worktree add ../dreamlabs-sales-painpoint -b codex/pain-point-pick origin/main`.

All implementation, installation, tests and documentation changes are confined to `C:/Users/kevin/Projects/dreamlabs-sales-painpoint`, branch `codex/pain-point-pick`, based on `f5d71a65c67b767a46881ff209e5ef61c2de821a`. The completed picker checkout/branch was not edited or switched.

- `b682c36`: pure validation/output parsing and structured choices in existing model calls.
- `9821e19`: append-only storage and manual precedence in drafting paths.
- `28d182f`: lead and review editors, plus retained draft-template identity.
- This report and one short dated `HANDOFF.md` section follow in the documentation commit; see `git log` for its hash.

All commits stage explicit paths, disable hooks with `git -c core.hooksPath=NUL commit`, and end with the required Codex co-author trailer. No vault sync or other-checkout write occurred. `AGENTS.md` and `CLAUDE.md` were not changed.

## What was built

Tailored drafting can select an ICP pain point or propose another angle, return a reason, persist it on the lead and use it in later drafts. The lead panel, full lead record and standard email-review composer show the current choice and AI reason, or label it as chosen by the representative. Autopilot's parked-draft review uses that same composer. Controls offer the applicable ICP list or free text; saving appends an explicitly manual note. Loading, read/save error messages, labelled controls, real buttons, focus styles, wrapping text and existing theme tokens are included.

Existing reviewed email text is not silently replaced when the representative changes the pain point. The editor explicitly says to personalise again or edit the email before sending. Queue/Autopilot/Dashboard review callers now carry the saved template ID, so the editor can use its ICP fallback and regeneration can start with that template. No new send action or automatic send was added.

## Pure contract and validation

`PainPointPick` is `{ pain_point, source: 'icp_list' | 'proposed', reason }`. Manual precedence uses a separate `ChosenPainPoint` type with `source: 'manual'`.

- The ICP's original line/bullet stripper is extracted into `icpPainPoints.ts` and reused by both `topPainPoint` and the new picker. Original template fallback text is unchanged.
- The tailored picker trims/collapses whitespace, applies the existing `stripAiPunctuation`, removes case/spacing duplicates and excludes empty or over-300-character items. It never truncates an ICP item and then mislabels the result as an exact list choice.
- Generated pain points and reasons must be nonempty and at most 300 characters after cleaning. A reason is one line; the prompt requests one plain sentence. AI source must agree with canonical cleaned list membership, ignoring case and spacing. Invalid source/text/reason combinations are rejected.
- Notes output is `{ talking_points: string[], choice: PainPointPick }`. Up to four nonempty talking points are retained, at most 500 characters each. JSON fences are accepted. Malformed JSON/fields fall back to the first valid list item with a neutral, explicit no-signal reason. Without a list, the fallback is null rather than an invented angle.
- Parsing failures log only `pain-point pick: invalid notes output; using the saved profile fallback`. Returned model text, lead text and secrets are never included in that log. The notes parser does not retry the model.

## Storage and precedence

No column or migration is needed. A structured AI choice is an existing `lead_notes` row with `note_type: 'ai_summary'`, a version marker, the compatible `Main pain point:` line and separate source/reason lines:

```text
Pain point pick v1
Main pain point:
Cleaner cover
Pain point source:
icp_list
Pain point reason:
The saved lead notes mention staff cover.
```

Human changes use the same format with `source: manual`, `note_type: general` and the signed-in representative as `created_by`. They use existing authenticated note permissions. AI persistence does not update or delete any note. Duplicate saved AI choices with the same text/reason do not create another row.

Resolution reads the complete history in 1,000-row pages, newest first with an ID tie-break. It first chooses the newest human note containing `Main pain point:`, even if many newer AI notes exist. A representative-edited AI note (`edited_at` set) is also treated as manual. Existing long manual text is preserved; new manual entries are limited to 300 characters. Only after excluding all manual choices does resolution use the newest marked AI choice. Unmarked historical AI text is not misclassified as a human instruction.

AI writes re-read that history immediately before saving. If a manual choice exists, the AI choice is not appended. The Sonnet talking-points note is still saved, but without an AI Main pain point section. Concurrent inserts cannot overwrite a human row because storage is append-only; subsequent resolution still gives the human choice priority. These are not transactional snapshot/locking guarantees. In selected Autopilot, a detected manual angle change during drafting reuses the existing failed-draft review path instead of treating the draft as ready to send.

The UI shows the **current lead choice**, not an immutable snapshot of the angle used for every historical email. Existing reviewed text needs regeneration/editing after a choice change. Cross-tab/concurrent UI invalidation and concurrent AI initial picks were not exercised.

## Prompt and flow integration

Prompts pass the cleaned list and existing choice as data, require manual precedence, forbid invented lead facts, request one factual reason and direct the email around the chosen angle. No-signal instructions choose the first list item; a proposed angle is allowed only when no listed item genuinely fits.

- `generateLeadNotes` retains its single Sonnet call. That call now returns talking points plus the structured choice. Its output allowance rises from 300 to 600 tokens to hold the JSON fields; no additional notes call or new retry is introduced. The sequence notes-once/compatibility gates remain intact.
- Outreach sequence drafts remain Haiku. They receive the structured choice/reason from saved notes or the notes pass. Manual choice resolution uses full history rather than the old small drafting-context window.
- Existing Gemini-only `generate-email`/non-outreach tailored drafts retain their model and return the choice alongside subject/body in their existing call. There was no Sonnet notes call in those paths to extend; adding one would add a model call per lead.
- Selected Autopilot's existing website/Gemini research remains unchanged. After the sequence/template ICP is known, its existing Haiku drafting call returns the choice alongside the draft, using saved manual/AI context when present. No extra Sonnet pass, research call, cost constant or model switch was added.
- Discovery `run-autopilot` does not itself write tailored drafts; its existing enrolment flow reaches `check-sequences`. Its entrypoint is unchanged.

AI choices use `ai_summary`, the existing AI-note mechanism. Consequently, a saved choice also satisfies the existing “has AI summary” cache check; it does not schedule another research pass. This is a deliberate no-extra-call decision for architect review.

`buildTemplateVars` in both frontend and Deno is untouched. It still uses the existing noted Main pain point first, otherwise the ICP's original first line. The current sequence step's `varNotes` snapshot is still taken before the notes pass. Storing a compatible lead note naturally makes that noted value available to future template filling; the substitution algorithm, template choice and template-sequence routing were not changed. Angle-specific template selection remains Phase 2 and is not built.

## Files changed

- Shared server/pure logic: `supabase/functions/_shared/icpPainPoints.ts`, `icp.ts`, `painPointPick.ts`, `painPointStorage.ts`, `ai.ts`.
- Draft integration: `supabase/functions/generate-email/index.ts`, `check-sequences/index.ts`, `_shared/selectedLeadSteps/draft.ts`.
- UI: `src/components/pipeline/PainPointCard.tsx`, `PainPointEditor.tsx`, `LeadPanel.tsx`; `src/hooks/usePainPoint.ts`; `src/pages/LeadDetailPage.tsx`.
- Review integration: `src/components/emails/EmailComposer.tsx`, `ReleaseQueue.tsx`; `src/components/autopilot/NeedsInputReview.tsx`; `src/pages/Dashboard.tsx`.
- Tests: `src/lib/painPointPick.test.ts`, `painPointAi.test.ts`, `painPointStorage.test.js`, `painPointUi.test.ts`.
- Documentation: this report and one short dated section in `docs/HANDOFF.md`.

New UI components are 12 and 48 lines; the new hook is 40 lines. Existing large email-composer code was not broadly refactored.

## Baseline, TDD and gates

Ran the requested `npm ci` offline from cache with audit/funding calls disabled. Bootstrapped the existing PostalMime/ImapFlow edge-test dependencies into ignored scratch using the documented command with `--offline --ignore-scripts`; root manifests/lockfiles are unchanged. npm reported blocked esbuild/workerd installation scripts; the build works without approving them.

Before implementation, all baseline gates passed: TypeScript, **190 files / 2,705 tests**, build (**2,925 modules**), the 24-entrypoint edge typecheck and whitespace.

Tests were written before implementations. New pure/storage/UI tests initially failed on absent modules; four AI-call tests failed against the old behaviour before the prompt/parser changes. A subsequent boundary regression failed when an overlong ICP item was truncated, then passed after excluding that item and preserving long manual text. Fixtures exercise real pure parsing/storage decisions and server-rendered controls. AI HTTP responses and note persistence are local fakes; no test calls an external service.

Final application revision: `28d182f`.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS, zero diagnostics |
| `npx vitest run` | PASS, **194 files / 2,740 tests / zero failures** |
| `npm run build` | PASS, **2,932 modules**; existing >500 kB bundle warning remains |
| `git diff --check` | PASS |
| `git diff f5d71a6..HEAD --check` | PASS |
| `node scripts/places-edge-typecheck.mjs` | PASS, **24 entrypoints**, compiler shim only |

Increase: **four files / 35 tests**. Tests cover bullet cleaning, list/proposed source consistency, bounds/punctuation, malformed/fenced output, safe fallback/logging, manual precedence beyond one history page, append-only persistence, existing manual text, one-call/model behaviour, template fallback and visible controls/reasons/states. Logs are ignored local `pain-*.log` files.

Only the specified dummy local environment was used: `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY=local-test-placeholder`. Subscription usage is not exposed; no percentage or paid fallback is claimed.

## Unverified

Deno runtime and real Supabase/RLS writes, a real AI response, semantic quality/factuality of model reasons and angle focus, concurrent requests/uncertain network outcomes, end-to-end run/review/regeneration, browser, keyboard/screen reader, phone-width overflow and both visual themes were not verified. Server rendering does not establish those browser guarantees. The existing model retry/deadline and review paths remain responsible for failures outside the new parser. No independent Claude review occurred in this builder session.

No readiness/eligibility module, send/spend cap, review-before-send rule, grant or RLS policy changed. No migration or audit was written or applied. Apart from the expressly requested Git fetch, no remote/provider service call occurred; there were no Supabase writes, real credentials, mail/messages, push, merge or deployment. No background job remains.

## Deployment manifest and safe order — not executed

After Claude's review and Kevin's separate rollout authorisation:

1. No database step is needed. Retain the current release for rollback.
2. Deploy the affected edge bundles first. The three active pain-point integration entrypoints are `generate-email`, `check-sequences`, `run-selected-autopilot`. A local recursive relative-import audit gives this conservative complete manifest of **15 entrypoints** that bundle the changed shared AI/ICP modules:
   `check-replies`, `check-sequences`, `draft-linkedin-message`, `draft-reply`, `find-decision-makers`, `generate-email`, `parse-csv-leads`, `parse-notes`, `parse-session-notes`, `run-deep-find`, `run-selected-autopilot`, `scrape-companies-house`, `scrape-cro`, `scrape-google-places`, `suggest-sequence`.
   Redeploying the complete manifest keeps shared bundle revisions aligned; callers without the new optional pain-point inputs retain their existing output contract. `run-autopilot` needs no separate deploy for this change.
3. Verify manual precedence, malformed-output fallback and reviewed regeneration using disposable authorised fixtures; verify no real person is contacted. Deploy the frontend after edge verification.
4. Perform the outstanding phone/theme/keyboard checks and a small reviewed tailored-draft test. Roll back by restoring the preceding frontend/edge bundles if needed. Existing notes are compatible text and need no schema rollback; preserve human notes.

Stop here. Claude reviews this branch, especially same-call choices in paths without Sonnet notes, the AI-summary cache decision, manual precedence and template compatibility, before any merge or rollout.
