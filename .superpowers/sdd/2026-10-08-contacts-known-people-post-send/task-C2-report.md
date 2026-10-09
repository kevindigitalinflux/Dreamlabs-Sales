# Task C2 report: post-send decision rules

Files: supabase/functions/_shared/postSendRules.ts (import-free), src/lib/postSendRules.test.ts (31 tests).

RED: first run of the focused test failed at import (module missing), "no tests".
GREEN: 31/31 after implementation (one test regex corrected to match the reason wording). tsc --noEmit clean; --ignoreConfig syntax check 0 TS1 errors; full vitest 44 files, 872 tests pass.

Rules chosen
- Default template resolution: `buildDefaultTemplateIdByType(templates, orgId)` keeps only templates visible to the org (org_id = org or null) with is_default; org default beats global default. `stepUsesTemplate`: step.template_id wins (exact id match); otherwise map[step.template_type] === template.id.
- Note: `Email sent: <subject> (to <label>)`; subject has em/en dashes replaced by ", " and is cut to exactly 120 chars (no ellipsis); same cleaned subject is used in the default follow-up note.
- link_only (log already linked): no advance/enrol; next-action date from the supplied enrolment's next_send_at (step = its current_step) when active, else default +3 days.
- Active enrolment: advance only if the sent template is the template of its current step (uses nextEnrollmentState arithmetic; past last step => completed, step kept, nextSendAt null, then default +3 day follow-up); otherwise none. Unknown sequence / out of range step / null template => none.
- Paused => none (never enrol over it). none/completed/cancelled => enrol when exactly one sequence uses the template at exactly one step and a following step exists (newCurrentStep = i + 2); null template, zero/many sequences, many steps, last step => none with a plain reason.
- Next action: set only if current date is empty or <= todayLocal (first 10 chars compared); date = toLocalDate(nextSendAt) (default slice(0,10)) with `Follow up: <seq> step N of M`, else todayLocal + defaultFollowUpDays (Date.UTC math) with `Follow up after email: <subject>`.
- Extra output field `totalSteps` (for UI lines). describePostSend returns e.g. 'Moves the lead to step 2 of Cold outreach', 'Follow-up set for 2026-10-12', 'No sequence change', 'Your existing next action date is kept'.
- Extra export `buildDefaultTemplateIdByType` and `VisibleTemplate` type.
