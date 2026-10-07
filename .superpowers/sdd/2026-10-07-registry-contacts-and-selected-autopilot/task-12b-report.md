# Task 12b report: selected-leads autopilot per-lead pipeline

Contract in `selectedLeadPipeline.ts` (PipelineContext, PipelineOutcome, processLeadPipeline) is unchanged. No optional fields were added.

## Step map

| Spec step | Where |
|---|---|
| 1 Load org, sender, keys, candidates, notes, sequences, templates | `selectedLeadSteps/load.ts`: `loadOrgContext`, `loadCandidates`, `loadNotes`, `loadSequencesAndTemplates` (sequences and templates are loaded just before step 5, after the cheap stop checks) |
| 2 Creator can view/send | `load.ts: creatorCanSend` + pure `canCreatorViewLead` (Rules). Id-based equivalent of `can_view_lead` (migrations 018/023): org admin; default pipeline: lead has no creator, or creator/assignee is the run creator; named pipeline: pipeline owner or an explicit `pipeline_shares` row. Membership in the run org required on top. |
| 3 Recipient | `selectedLeadSteps/recipient.ts: ensureRecipient` (`pickRecipient`, then `enrichOneLead` + `fillBlankPatch`, then `findAndStoreDecisionMakers`, reload, retry) |
| 4 Research | `selectedLeadPipeline.ts: run` using `researchLead`; note saved only if `!isEmptyResearch` (`researchPages.ts`) |
| 5 Sequence + step | `selectedLeadSteps/sequence.ts: chooseSequence` (`chooseSequenceClaude` in `ai.ts`, then `pickSequence`) |
| 6 Draft | `selectedLeadSteps/draft.ts: buildDraft` (template via `chooseTemplate`, `buildTemplateVars` + `recipientVarOverrides` + custom vars, `draftEmailClaude` Haiku, `stripAiPunctuation`, `appendLinks`, org attachments, ICP context) |
| 7 Placeholder safety | `selectedLeadPipeline.ts: draftProblem` + `park` (saves `email_logs` draft, returns needs_input with emailLogId) |
| 8 Send safeguards | `send.ts: lastMinuteCheck` -> `ctx.reserveSend()` -> `insertDraftLog` -> `sendDraft` (`markSendStarted` -> `sendLeadEmail`) |
| 9 After send | `send.ts: recordSendEffects` (note, enrol/advance via `nextEnrollmentState`, next_action_date/note); each part best effort |
| 10 Whole wrapper | `selectedLeadPipeline.ts: processLeadPipeline` |

Pure rules: `_shared/selectedLeadPipelineRules.ts`, tests `src/lib/selectedLeadPipelineRules.test.ts` (33 tests, written first and seen failing).

## Every place a lead can be skipped, parked or failed

- skipped: creator cannot access lead; no email after enrichment + decision-maker search; sequence already finished (step > steps); last-minute check (lead gone, other org, opted out, blocked, closed, paused, not due, recently contacted, recipient address/domain blocklisted); reserveSend false (cap reached or run stopped).
- needs_input: no Anthropic key; creator profile has no name (never uses "The"); ran out of time (after recipient, research, sequence, draft; draft is saved for the draft-stage timeout); no suitable sequence; enrolled sequence not found; chosen sequence has no steps; template for step not found; unfilled placeholder (including variables substituteVariables blanked, and any leftover `{{`/`}}`); AI draft failed (plain template saved as a draft); empty subject/body; chosen decision maker dismissed during the run is a skip, not a park.
- failed: unexpected throw before markSendStarted (releases a reserved slot); draft insert failed after reserving (releases); markSendStarted rejected (releases, keeps emailLogId); `sendLeadEmail` `ok:false` (releases, keeps emailLogId, error passed through `plainReason`); any throw after markSendStarted -> "Error after send started; check Email logs" (never releases, never retries).
- Once markSendStarted has been called, nothing checks the deadline.

## Extracted from other functions (behaviour intended identical)

- `enrich-leads-bulk/index.ts`: moved `enrichOneLead` and its types (`LeadRow`->`EnrichLeadRow`, `Field`->`EnrichField`, `EnrichResult`, new `EnrichKeys` alias for the inline keys type) plus the lookup imports into `_shared/enrichLead.ts`. Function body untouched; index imports it.
- `find-decision-makers/index.ts`: moved the per-lead body (Hunter/Apollo rows, upsert with ignoreDuplicates, re-select, linkedin_contacts auto-capture) into `_shared/findDecisionMakers.ts: findAndStoreDecisionMakers(service, lead, {hunterKey, apolloKey}, userId)`. Index keeps auth, membership check, key resolution, runBounded, filtering of empty results.
- `leadResearch.ts`: `FALLBACK_NOTE` moved to `researchPages.ts` as exported `RESEARCH_FALLBACK_NOTE` (same text) and `isEmptyResearch` added next to it.
- `ai.ts`: new exported `chooseSequenceClaude` (Haiku, uses `claudeJson` with its stop-reason check and retry).

## Deviations and decisions

1. Sequences load includes org-less shared sequences (`org_id` null) as well as the org's, mirroring templates and what the UI shows. A shared sequence whose step templates the org lacks parks safely.
2. Template resolution is an in-memory port of check-sequences' logic (`chooseTemplate`), since templates are loaded up front. check-sequences was not changed.
3. No unsubscribe line is appended: like check-sequences, it only appears if the template uses `{{unsubscribe_url}}`. A template without it sends without an unsubscribe link.
4. Variables that `substituteVariables` blanks are treated as unfilled placeholders and park the draft (otherwise "Hi ," would send). This means a lead with no known first name parks when the template uses `{{first_name}}`.
5. `generateLeadNotes` (Sonnet) is not called; the research note is the notes pass. When research is empty the draft uses lead data and existing notes only.
6. Not linked: `email_logs.sequence_enrollment_id` is not set, so selected-run sends do not count toward discover-mode daily caps in check-sequences.
7. Costs: research cost from `researchLead` (3 cents, also counted if it times out and a Gemini key exists), 1 cent per draft attempt (same as check-sequences), 1 cent per Haiku sequence pick. Hunter/Apollo/Places credit costs are not tracked in cents.
8. AI-failed drafts park instead of sending the plain template (check-sequences would draft it for human release; here it is unattended).
9. `lastMinuteCheck` reads the lead stage fresh and passes it with `orgId` to `sendLeadEmail` (both together, per ruling).
10. If `sendLeadEmail` reports a logging warning after a successful send, the pipeline repairs the log row to `sent` so it cannot be released twice from the draft queue.

## Verification

- Focused vitest 33/33; full `npx vitest run` 462/462 (30 files); `npx tsc --noEmit` clean.
- Syntax check (`--ignoreConfig`, grep `error TS1`) clean for: selectedLeadPipeline, selectedLeadPipelineRules, enrichLead, findDecisionMakers, ai, leadResearch, researchPages, all selectedLeadSteps files, enrich-leads-bulk/index.ts, find-decision-makers/index.ts.
- Orchestration is not unit tested (no Deno runner); nothing deployed, no DB commands run.

## Concerns

- Live verification (throwaway org) still needed before release; the two refactored functions (enrich-leads-bulk, find-decision-makers) must be redeployed and smoke tested because they now import the new shared modules.
- An overlapping `check-sequences` run could draft a duplicate for an enrolment between the send and the enrolment advance (tiny window).
- `creatorCanSend` duplicates SQL logic; if `can_view_lead` changes it must be updated.
- `raceDeadline` cannot cancel the underlying work: enrichment or decision-maker search may finish after the lead returned (they only write fill-blank details/candidates).
- Hunter/Apollo paid lookups run unattended whenever the org has keys and a lead has no email.
