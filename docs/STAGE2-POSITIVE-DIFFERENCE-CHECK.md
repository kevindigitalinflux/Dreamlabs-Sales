# Stage 2 positive-difference and session-close check

Date: 2026-11-16. Codex remains builder; Claude remains architect/reviewer. Kevin requested a positive-difference check and updates to the project and shared context before closing the tab. This authorizes documentation/vault updates, not rollout or live provider calls.

## Compared revisions and scope

Baseline: 8c1c61b3fb8d601cbefee2b84b14c9590cc11c1f. Completed build/report revision: 2a018da5045d183e8b96eace2585edd1f04b0462. Application code: 50ca647b40f7b2fe345e9c35d4ddc6c173a0a93b. Verifier branch remains cf6006e635f15660f8f846a0877f3039daf4ee92.

Five baseline source files were read from local Git objects into ignored .superpowers/positive-difference/baseline. No branch switch, tracked-code edit, installation, network request, database call or provider call was needed. Tests exercise old and current functions with the same fixtures; timers and fetch are fake.

Command: npx vitest run --config .superpowers/positive-difference/vitest.config.mjs

Result: one file / three tests passed, zero failed. Test source and output are retained in .superpowers/positive-difference/compare.test.ts and results.log. These are local scratch artifacts. The concrete observed results are recorded below so the evidence does not depend on that scratch directory surviving.

| Same fixture | Baseline result | Current result | What is established |
| --- | --- | --- | --- |
| One person, Microsoft/provable domain, eight candidate formats | Eight SMTP guesses | Four ms_exists checks | The stalled SMTP guessing path is avoided for this queue case, with the approved four-format cap |
| domain_stalled refusal at attempt four, now=1000 ms | Terminal done/unverifiable | Queued for 601000 ms | A refused call preserves the retry opportunity; SQL restoration of the claim's attempt is separately unexecuted |
| A checker that never answers, default wrapper timing | Aborts at 30 seconds and returns checker_error | Still pending at 30 seconds; aborts at 45 seconds and returns timeout | More response time and a correct timeout reason, without treating an abort as a provider error |

The earlier build also has passing regression fixtures for per-lead windows, cancellation, domain isolation, exact company/role/former-person judgment, team pages, blank-only contact merges, no enrollment and informational Gemini counting. Application coverage rose from 3,368 to 3,494 passing tests (+126); wrapper coverage rose from 143 to 163 (+20). More tests are coverage evidence, not an accuracy or conversion-rate measurement.

## Final verification and limits

All seven required gates pass on the unchanged application code. Closing-run logs: .superpowers/stage2-close-*.log. Counts: 274 app files / 3,494 passed / one skipped; eight wrapper files / 163 passed. Root and wrapper TypeScript, production build, whitespace and 29-entrypoint edge typecheck pass. The existing skipped test is the opt-in built-static-assets check in src/lib/setupSkillDownload.test.js; no new test was skipped. The existing large-chunk build warning remains.

Positive local behavior is demonstrated. Production improvement is NOT VERIFIED. The historical 50-lead baseline remains ready 25/50, right-role person 18/50 and LinkedIn 1/50; no new live score was obtained. The later Ireland/EU/Gulf baseline in the shared log is also unchanged. SQL migrations/audits/scorer, real RLS/concurrency, Docker startup, browser/mobile/theme, engine throttling, real provider checks and independent Claude review remain pending. No rollout, SQL, VPS change, paid API, spending, push or merge occurred.

## Context and safe stopping point

Project instructions, build report, handoff and next steps point here. Shared vault Status, Decisions, Log and Handoff plus the Dreamlabs Sales entry in the shared index are updated. Branch documents/spec/plan/migrations/audits/scorer are copied to a labelled branch checkpoint, never over the accepted-main Repo mirror. The original historical Handoff snapshot remains below its new current pointer.

No builder task remains through Task 6. No task-owned dev server remains running. Subscription usage is unavailable; no paid continuation was used. It is safe to close this tab: the next session can resume from the saved handoff. Next action is Claude's independent review; production operations still require Kevin's separate authorization.
