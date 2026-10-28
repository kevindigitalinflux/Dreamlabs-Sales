# Run controls and reply UX — round 2 build report

Date: 2026-10-28. Worktree: `C:/Users/kevin/Projects/dreamlabs-sales-ux`; branch `codex/run-controls-reply-ux`. Round 1 began at `5414122`, based on `c678d73`; round 2 began from `f3a13c9` plus the supplied round 2 brief. Tested application revision: `81abb5d`. Documentation-only commits follow. Codex remains builder; Claude remains architect/reviewer. Independent review is pending. No release is authorized.

## Part 1 / Round 2 A — Pause, Resume, serialization

Implemented migration `supabase/migrations/070_autopilot_run_pause.sql`, its separated rollback audit, service-side claim/finish RPC integration and authenticated controls. Design precedes implementation in `docs/RUN-PAUSE-IMPLEMENTATION-DESIGN.md`.

The architect's binding ruling replaces the round 1 question. Pause means do not start the next lead. Status changes immediately to paused; the screen says **Pausing, finishing the current email** while a working row remains. **At most one email can complete after Pause commits:** a reservation acquired before Pause may finish SMTP, notes, enrolment, row outcome and counter recording normally. No later claim or send reservation may succeed.

Migration definitions were traced to 006 (status CHECK), 048 (per-mode unique index/queue), and 049 (status guard, column grants and reserve RPC); repository searches found no later replacements. No live service/database query was made. Migration 070 adds paused, nullable server-managed paused_at/resumed_at and an immutable queued_at ordering column initialized from existing updated_at. The unique partial index now covers active and paused. No RLS, existing UPDATE grant, cap amount or reserve counter arithmetic changes. A new insert guard prevents browsers from supplying pause/resume timestamps through inherited table INSERT rights.

`autopilot_control_run` is a fixed-search-path SECURITY DEFINER RPC. It verifies authenticated membership and creator/admin authority, locks the run, and allows only supported controls. Stopped-run resume requires exactly `stopped by user` plus queued rows. Failure/completed runs cannot resume. A competing live run produces a plain error; the index also closes concurrent cross-run races. The status trigger independently checks direct browser ownership, rejects same-status reason forgery and restricts stopped-run resume to privileged execution. Browser column UPDATE grants remain status/cancel_reason only. Sensitive transitions use the RPC rather than giving the browser broader grants.

### Lock reasoning and test scope

- Pause UPDATE, `autopilot_claim_lead` SELECT FOR UPDATE and the existing `autopilot_reserve_send` conditional UPDATE all lock the same run row. Under PostgreSQL row-lock semantics, an operation waiting behind Pause observes/rechecks paused and cannot pass its active predicate.
- Claim checks active/selected after locking and refuses any run with a working row. Concurrent ticks therefore cannot own two leads or have two previously reserved emails in flight for the same run.
- If claim wins before Pause but reserve follows Pause, reserve fails. The unreserved row returns to queued after recording research cost; queued_at preserves its position.
- If reserve wins before Pause, that one working row may finish. Resume before it finishes still cannot admit a second worker while its working row exists.
- Completion uses `autopilot_finish_selected`, taking the same run lock and checking active/no working rows before completing or consuming queued rows. A stale completion cannot discard a queue after Pause commits.
- Recovery preserves paused and user-stopped queues. Stuck working rows retain the existing marker policy: unstarted work requeues; a send that may have started fails and is never automatically retried. Terminal failure/completion queues become not reached.

Deterministic locked-row doubles exercise concurrent claims, pause-before-claim, claim-before-pause/stale-reserve, reserve-before-pause and second-worker denial through the real claim wrapper. Recovery tests call the real recovery function and assert only terminal queues change. Rule tests cover preserved queues and resumed waiting. Structural SQL assertions check lock placement, working-row exclusion, unique-index predicate and service-only access. These are **not an executed PostgreSQL concurrency proof**. Both SQL blocks and the documented two-session contention exercise remain unexecuted, as migration/database execution was prohibited. Real database verification is a required review/rollout gate.

### Resume checks and scheduling decisions

Resume changes the same run to active and leaves its queue, counters, spend history and caps intact. The existing cron tick processes it through the original membership/mailbox, draft, eligibility, final send, address-history and reservation paths; control RPCs never send. No new cron or external send path exists. Explicitly replied leads now fail the shared eligibility check even when a sequence is due, with a plain skip reason. Reply detection/effects remain unchanged. Opt-outs, parked drafts and the existing 14-day address guard remain in their existing paths.

Paused runs never auto-resume, including across days/windows/restarts. After explicit resume, the engine calculates today's Europe/London window. Outside it, or at an unchanged run send/spend cap, it waits without consuming queued rows. Empty resumed queues complete. No counter resets occur. The run send cap remains cumulative for that run; reaching it cannot manufacture a fresh allowance tomorrow. The UI states that no more emails send under that cap. Any existing downstream sender limits still apply; the UI also states that sending waits for the sender's daily allowance and safety checks. Resume processing starts on the next existing two-minute cron tick, rather than creating a second immediate worker.

## Part 2 / Round 2 B — run screen

Active shows Pause and Stop; Pausing shows a disabled finishing message plus Stop; Paused shows Resume, Stop and elapsed pause minutes; user-stopped with queued rows shows Resume this run and Start a new run; completed shows Start a new run. Only creator/admin sees controls, independently of database enforcement. Status uses role=status. After requests, focus returns to a stable status paragraph. Paused runs remain selected/polled. The layout wraps controls and keeps shared theme tokens.

Sections use real disclosure buttons, counts, chevrons, aria-expanded and aria-controls. Needs your input always starts open; other groups above eight rows start closed. State remains local and does not reset as row counts change. Loading, error and empty states remain. Browser focus/keyboard/phone-width execution is unverified.

## Part 3 / Round 2 C5 — Replies

List rows retain whole-row buttons, chevrons, hover/focus states, New labels, preview and relative receipt time with exact timestamp available. Opened order is back link, large business heading, muted subject, compact From/time/stage/Open lead metadata, opt-out warning, readable reply card, action group, then closed-by-default original email. No fake sender name is shown. Primary AI/manual/handled actions and existing composer/threading/handling behaviour are retained. Automatic replies remain filtered upstream; no detection change or invented warning field was added. Server-rendered layout assertions verify reading/action/original order and closed original disclosure.

## Part 4 / Round 2 C2 — readiness colours

Shared badge retains text and icon, with matching 40% border and 10% colour tint. An opaque card-colour wrapper fixes the tint's base across all callers and parent surfaces. All current badge callers inherit the change.

Calculated sRGB WCAG text contrast on the 10% tint over light card #FFFFFF / dark card #111C6A:

| State | Light text | Light ratio | Dark text | Dark ratio |
| --- | --- | --- | --- | --- |
| Ready | #147739 | 4.89:1 | #22C55E | 5.75:1 |
| Almost | #8A5906 | 5.19:1 | #F59E0B | 6.20:1 |
| Needs work | #C40A0A | 5.17:1 | #F87171 | 4.87:1 |
| Not checked | #566781 | 5.03:1 | #94A3B8 | 5.05:1 |

All exceed 4.5:1. These are calculated token/composite ratios, not browser measurements.

## Part 5 / Round 2 C3–4 — names and phones

Original cause: capitalised greetings adjacent to roles passed the website name-shape parser; the broader saved-name parser accepted them too. Both now reject greeting phrases at word boundaries, including honorific-disguised greetings. Website extraction retains Person/jobTitle or visible name/decision-maker-role context requirements. Added hola, bonjour, g'day/g’day/gday, namaste, ni hao, aloha, howdy, cheers, thanks and thank you to the original Kia Ora/English cases. Hilary Hill and Hiroshi Tanaka remain accepted. No live website or saved contact was inspected/repaired.

Company-line deduplication now passes the lead's country through existing phoneNumbers.ts parsing, so GB national 020 and +44 versions share a canonical key. Existing lead-level phone evidence/match labels take precedence, direct lines remain per person and saved numbers are suppressed by existing visibility rules. No automatic contact-phone fill was introduced.

## Files and commits

Round 2 application commits: `65da774` serialization/schema/recovery; `b8e34c4` controls/status UI; `4ee4771` review fixes; `81abb5d` insertion-metadata protection. `661611f` updates existing handoffs and automation register in place. This report receives a final documentation-only commit.

Changed or added across both rounds:

- `supabase/migrations/070_autopilot_run_pause.sql`, `supabase/audits/070_autopilot_run_pause.sql`
- Shared edge modules: `selectedAutopilot.ts`, `runPauseRules.ts`, `selectedAutopilotRules.ts`, `autopilotEligibility.ts`, `deepFind.ts`, `deepFindRules.ts`, `phoneNumbers.ts`
- Autopilot UI: `RunControls.tsx`, `RunHeader.tsx`, `RunLeadGroups.tsx`, `SelectedRunSection.tsx`; `useSelectedRun.ts`, `AutopilotStatus.tsx`, shared types
- Replies/readiness UI: `RepliesPanel.tsx`, `ReplyDetail.tsx`, `ReadinessBadge.tsx`
- UI helpers: `runControlState.ts`, `runLeadGroups.ts`, `replyAlertsView.ts`
- Tests: `runPause.test.js`, `runPauseEngine.test.js`, `runControlState.test.ts`, `resumedReplyGuard.test.ts`, `runUxRound2.test.ts`, `replyLayout.test.ts`, original round 1 greeting/phone/time/disclosure tests and updated saved-phone expectation in `deepFindPhase3Engine.test.js`
- Design, this report, existing `AGENTS.md`/`CLAUDE.md`/`docs/HANDOFF.md` checkpoint blocks and `docs/AUTOMATIONS.md`

## Gates and limits

Round 2 baseline: **180 files / 2,592 tests passed**. Final: **186 files / 2,635 tests passed** (+6 files / +43 tests). Initial red regressions covered needs-input disclosure, tint styles, greeting variants, national/international phone dedupe, preserved queues, resumed waiting, control states, replied eligibility and metadata insertion protection. Supplementary orchestration/source/layout checks do not substitute for runtime/database tests.

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS, no diagnostics |
| `npx vitest run` | PASS, 186 files / 2,635 tests |
| `npm run build` | PASS, 2,917 modules; existing >500 kB chunk warning |
| `node scripts/places-edge-typecheck.mjs` | PASS, 24 entrypoints; no new entrypoint |
| `git diff --check`, round 2 range check | PASS |

Not verified: SQL syntax/runtime, actual constraints/grants/RLS/audit fixtures, real PostgreSQL lock contention, migration 070 execution, Deno runtime, browser/focus/keyboard, phone width, rendered themes, real IMAP/SMTP/AI, live runs or deployment. Read-only and disposable-local audit blocks are clearly separated and neither was run. No application dependency was added. Round 1's existing MIME/IMAP scratch dependencies remain local; round 2 made no external service calls or installation. No push, merge, deployment, remote/database write, real mail/message, other-checkout edit, vault sync or paid fallback occurred. Subscription usage is unavailable; no percentage is inferred.

## Review and safe rollout order

Claude reviews this report, design and code/SQL diff before any merge. No remaining product decision from round 1 is pending; database/runtime verification is still required.

When Kevin separately authorizes rollout: **migration 070 first**, then affected edge functions, then frontend. Keep old worker invocations drained before enabling controls, so no pre-070 direct-claim worker can bypass the new claim RPC. The existing cron schedule is unchanged. Audit execution requires separate authorization; only its first block is production-safe/read-only, and fixture/two-session tests belong on a disposable local database.

Static relative-import closure identifies these ten function bundles for deployment: `apollo-phone-webhook`, `enrich-leads-bulk`, `find-decision-makers`, `org-api-settings`, `reveal-decision-maker`, `run-deep-find`, `run-lookup-jobs`, `run-selected-autopilot`, `scrape-companies-house`, `send-email`. The conservative list includes shared/type-only dependency edges; all are in the existing typecheck manifest. No other function entrypoint changed. Review-before-send remains unchanged. The builder stops here after the report/documentation commit.
