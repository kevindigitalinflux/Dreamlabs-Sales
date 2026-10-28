# Run controls and reply UX — partial build report

Date: 2026-10-28. Worktree: `C:/Users/kevin/Projects/dreamlabs-sales-ux`. Branch: `codex/run-controls-reply-ux`. Starting revision: `5414122` (brief), based on `c678d73`. Tested application revision: `91d72f8`. Codex is builder; Claude is architect/reviewer. Independent review is pending.

**The brief is not fully implemented. Do not merge or deploy this as the completed run-controls feature.** The in-flight-send decision below remains pending. The builder has stopped after this report as requested.

## Part 1 — not implemented; decision required

No Pause/Resume controls, paused status, migration 070 or audit 070 were written. Existing run behaviour remains in place.

The current engine claims a lead, performs asynchronous work and reserves a send before handing off to SMTP. A browser status change cannot recall SMTP already in flight. `autopilot_reserve_send` checks active status, but a reservation already acquired can outlive that status. Recovery also currently treats every non-active run as ended, including queued rows. Merely allowing a paused status would lose queue rows and would not establish the required send boundary.

Question sent to Kevin: **If Pause is pressed while an email is already sending, may that email finish before the run becomes paused?** Choices were finishing the current lead before pausing, or rejecting Pause while a lead is processing. No answer arrived before this checkpoint. This is an unresolved user-visible safety contract, not permission to publish. The brief explicitly allows stopping an item needing Kevin's decision.

Next implementation must serialize claiming and pause transitions, preserve queued rows for paused/user-stopped runs, preserve send markers and reservations, narrowly constrain resuming user-stopped runs, and test concurrent pause/reserve/claim and stale-worker cases. It must also resolve daily/window rollover without increasing allowance or resetting spend history. The recommended policy remains a proposal: stay paused across days/windows until explicit resume. No auto-resume policy has been implemented.

The original index and guard were read from migrations 048 and 049. No live database was queried, consistent with the prohibition on external services. No RLS, grants, guards, caps, reserve logic or cron was changed.

## Part 2 — disclosures built; state actions pending Part 1

Each non-empty group uses a real button, count, chevron, `aria-expanded` and `aria-controls`. Groups with more than eight rows start closed; smaller groups start open. State is local to the mounted group and persists through row-count changes. The hidden list stays associated with its control. Loading, error and empty states remain.

Run status/action changes and pause duration are not implemented. Phone-width, theme and keyboard execution in a browser remain unverified.

## Part 3 — presentation improvements built, acceptance gaps remain

Replies list has a selection hint, whole-row button, chevron, hover/focus outline, explicit bold New label, preview and relative time with exact timestamp available on the time element. Detail has Back to replies, business name, lead stage label/chip, sender address, receipt time, larger readable reply text, a closed-by-default Show original email disclosure, and a distinct opt-out warning. Mark handled uses the tertiary ghost style. Existing AI/manual composer paths and handling/opt-out actions are unchanged.

Remaining gaps: sender display names are not present in the saved `EmailReply` model. The lead owner must not be presented as the sender. No ingestion/schema change was made to invent that identity. There was no existing automatic-reply warning in these components; automatic replies are filtered upstream, and detection was left unchanged. The existing AI-draft-ready label is retained. Browser interaction and complete component rendering coverage remain pending; the new relative-time helper is unit-tested.

## Part 4 — built

The shared ReadinessBadge now renders Ready green/check, Almost amber/triangle, Needs work red/cross and Not checked grey/question icon. Every current caller receives this shared change. Text remains intact, including missing-readiness reasons. It uses existing theme tokens on an opaque `bg-card` background.

Calculated WCAG text contrast, using sRGB relative luminance (light card `#FFFFFF`, dark card `#111C6A`):

| State | Light text | Light ratio | Dark text | Dark ratio |
| --- | --- | --- | --- | --- |
| Ready | #147739 | 5.63:1 | #22C55E | 6.59:1 |
| Almost | #8A5906 | 5.98:1 | #F59E0B | 6.99:1 |
| Needs work | #C40A0A | 6.19:1 | #F87171 | 5.43:1 |
| Not checked | #566781 | 5.75:1 | #94A3B8 | 5.86:1 |

All exceed AA 4.5:1. These are calculated token ratios, not browser measurements.

## Part 5 — greeting and switchboard fixes built

Reproduced Kia Ora as a Person JSON-LD entry and as visible role-adjacent text before changing production code. Seven greeting cases failed first. The cause is that capitalised phrases with a nearby owner/manager role passed the existing name-shape guard; greeting words were absent from its exclusions. The same phrase also passed the broader saved-name parser.

Both parsers now reject greeting prefixes, including Kia Ora, hello, hi, hey, welcome, dear and good morning/afternoon/evening/day. Website extraction retains its existing structural requirements: Person plus jobTitle, or visible name adjacent to a decision-maker role. This is a prefix guard layered on the existing context rules, not a general semantic name classifier. Real Jane Smith/Owner remains accepted. Existing callers of extractTeamMembers inherit this guard, including the Firecrawl reader. No live 24/7 Fitness page or persisted record was inspected or repaired.

Deep find now deduplicates company-line suggestions through phoneNumbers.ts, using its existing phone parser. A shared switchboard is offered once as Company line with a company-level phone action. Existing company-phone proposals take precedence and retain their source/match warning. Direct-line suggestions remain per person. Already-saved company numbers are suppressed by existing visibility rules instead of repeated as person proposals. No contact phone is automatically filled.

## Files changed

- `src/components/autopilot/RunLeadGroups.tsx`
- `src/components/emails/RepliesPanel.tsx`, `ReplyDetail.tsx`
- `src/components/pipeline/ReadinessBadge.tsx`
- `src/lib/replyAlertsView.ts`
- `src/lib/runUx.test.ts`, `greetingPerson.test.ts`, `companyPhoneDedupe.test.ts`, `replyTime.test.ts`
- `src/lib/deepFindPhase3Engine.test.js` (saved-switchboard expectation updated)
- `supabase/functions/_shared/deepFind.ts`, `deepFindRules.ts`, `phoneNumbers.ts`
- `AGENTS.md`, `CLAUDE.md`, `docs/HANDOFF.md`, this report

## Verification

Initial baseline: 176 files discovered; 175 passed, one failed to load (`replyMime.test.js`, missing local ImapFlow scratch dependency); 2,579 tests passed. Thus the expected 2,580-test baseline was not fully executed initially. Restored existing edge dependencies from the local npm cache with `npm install --offline --prefix .superpowers/reply-edge-deps --no-save --ignore-scripts --no-audit --no-fund postal-mime@2.4.3 imapflow@1`. No new application dependency or manifest change; no network service call.

New greeting, disclosure/icon, company-phone and relative-time regressions were observed failing before implementation. Four inherited engine expectations initially failed after company-phone conversion: one expected the old per-person fallback; three exposed lost Places match labels. The implementation now preserves existing lead-level phone evidence; the saved-number test now asserts suppression. Targeted engine tests pass, 129/129.

Final gates with dummy local Supabase values:

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS, no diagnostics |
| `npx vitest run` | PASS, 180 files / 2,592 tests |
| `npm run build` | PASS; existing >500 kB chunk warning |
| `node scripts/places-edge-typecheck.mjs` | PASS, existing 24-entrypoint shim |
| `git diff --check` | PASS |

Not verified: Deno runtime, browser, keyboard interactions, phone width, either rendered theme, live runs, SMTP/IMAP/AI, actual database constraints/privileges or migration execution. Migration 070 and its audit do not exist. No production or other-checkout change, push, merge, deployment, real message, vault sync or paid fallback occurred. Subscription usage is unavailable; no percentage is inferred.

## Review and eventual deployment

No release is authorized. Static relative-import traversal from changed shared modules identifies these affected function bundles: `apollo-phone-webhook`, `enrich-leads-bulk`, `find-decision-makers`, `org-api-settings`, `reveal-decision-maker`, `run-deep-find`, `run-lookup-jobs`, `run-selected-autopilot`, `scrape-companies-house`. This conservative bundle list includes shared/type-only dependencies; all are covered by the current edge shim. No new edge entrypoint was added.

For these implemented changes alone, no new migration is needed; reviewed functions precede the frontend. For the full brief, complete and review migration/audit 070 and run controls first, then separately authorize migration, functions, frontend in that order. Review-before-send must remain unchanged.

Commits: `5acf9f0` disclosures/readiness; `ea1b067` greeting/phone fixes; `91d72f8` reply presentation; `1e58ffb` handoff. This report receives a final documentation-only commit. Resume with the Part 1 question, then implement its concurrency-safe protocol and remaining acceptance gaps before claiming completion.
