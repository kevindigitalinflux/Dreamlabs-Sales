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

Pure rules: `_shared/selectedLeadPipelineRules.ts`, tests `src/lib/selectedLeadPipelineRules.test.ts` (32 tests at the first commit, written first and seen failing; the earlier "33" claim was wrong).

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

- Focused vitest 32/32; full `npx vitest run` 462/462 (30 files); `npx tsc --noEmit` clean.
- Syntax check (`--ignoreConfig`, grep `error TS1`) clean for: selectedLeadPipeline, selectedLeadPipelineRules, enrichLead, findDecisionMakers, ai, leadResearch, researchPages, all selectedLeadSteps files, enrich-leads-bulk/index.ts, find-decision-makers/index.ts.
- Orchestration is not unit tested (no Deno runner); nothing deployed, no DB commands run.

## Concerns

- Live verification (throwaway org) still needed before release; the two refactored functions (enrich-leads-bulk, find-decision-makers) must be redeployed and smoke tested because they now import the new shared modules.
- An overlapping `check-sequences` run could draft a duplicate for an enrolment between the send and the enrolment advance (tiny window).
- `creatorCanSend` duplicates SQL logic; if `can_view_lead` changes it must be updated.
- `raceDeadline` cannot cancel the underlying work: enrichment or decision-maker search may finish after the lead returned (they only write fill-blank details/candidates).
- Hunter/Apollo paid lookups run unattended whenever the org has keys and a lead has no email.

---

# Fix round 1 (commit "fix: autopilot pipeline send safety and reply detection")

Test count correction: the first commit had 32 rules tests, not 33. After this round: 57 rules tests; full suite 487/487; `npx tsc --noEmit` clean; `--ignoreConfig` syntax check clean on every touched Deno file. `npm run build` not run (no client `src/` files changed, only a test file).

| # | Done |
|---|---|
| 1 Reply detection | `send.ts: recordSendEffects` now writes the enrolment id onto the sent `email_logs.sequence_enrollment_id` (new enrolment via `.insert().select('id').single()`, existing via its id). email_logs has no sequence_id column, so nothing else is set. `check-replies` verified: it only acts when the sent log has `message_id`, `status='sent'`, `sent_by = mailbox owner`, `sequence_enrollment_id` and `lead_id`; `sendLeadEmail` sets message_id and sent_by = run creator, so replies now match and the enrolment is paused. check-replies edit (small): selects `to_email`; sender check now `replySenderMatches(from, sentLog.to_email, lead.email)` (new import-free `_shared/replyMatch.ts`, tested); the auto-draft reply `to_email` is now `sentLog.to_email ?? lead.email` (our own record of who we emailed, never the From header) so a reply from a decision maker is answered to that person. Scoping by Message-ID, mailbox owner and status is unchanged. |
| 2 Fail closed | `lastMinuteCheck` and `precheckLead` now check `error` on the lead, blocklist and enrolment reads and return `Could not check ...` / `failed` (never proceed). Also fail closed: decision maker dismissed read, recent emails read, opted-out read, `loadCandidates`, `loadSequencesAndTemplates` (now throw), member and pipeline reads (already threw). Audit notes: share-count error resolves to "not shared" (denies); org/profile lookup errors degrade to org name fallback / missing sender name (which parks); neither can cause a send. |
| 3 Greeting vs recipient | `recipientVarOverrides(candidate)` now always sets `first_name` and `owner_name` from the candidate (`''` when no first name, so a `{{first_name}}` template parks; first name only when the surname is obfuscated). `buildDraft` gives the template vars and the AI a lead copy whose `owner_name` comes from the candidate. `draftEmailClaude` gained optional `recipient` input adding `RECIPIENT: name, title. Address the email to this person only; never to anyone else named in the data.` (name/title `unknown` when not known; for the lead's own address the owner name is used). Pure `recipientLabel`. Other callers unchanged (prompt text identical when the options are absent). |
| 4 AI body | (a) optional `untrustedData` flag on `draftEmailClaude` adds the DATA not instructions sentence (autopilot only). (b) `unexpectedLinksOrAddresses` parks with `Draft contains a link or address that was not in the template` (allowed: filled template text, the template links, the unsubscribe URL; URLs compared exactly after trailing punctuation trim, case insensitive). (c) `withUnsubscribeLine` appends `If you would rather not hear from me again, you can opt out here: <url>` after the links block whenever the body lacks the URL. Extra safety I added: the draft also parks if the unsubscribe URL is not an https `/unsubscribe/` link (otherwise an unattended email would carry a broken or localhost opt out). (d) `hasStrayPlaceholder` (`[First Name]`, `{name}`) parks; `missing` is checked BEFORE the AI call, so no AI cost is spent on a lead that will park (a parked-for-missing draft is the plain template). |
| 5 Found email | `ensureRecipient` tracks the email applied by the fill-blank patch this run. If the recipient is that address (not a candidate), `canSendToFoundEmail` must pass: `emailMatchesWebsiteDomain` (www, subdomains, small co.uk style suffix list, free mail never matches, no website false) AND the website was already on the lead, or was found by a source other than `google_places`. Otherwise `needs_input` `Found a contact email; please confirm it before sending` (patch stays). Candidates with an email are used as before. |
| 6 Unsubscribe base | New import-free `_shared/appUrl.ts: publicAppUrl(appPublicUrl, appOrigins)`; Deno `templateVars.ts` now uses `APP_PUBLIC_URL`, else the first https entry of `APP_ORIGINS`, else the first entry. The frontend copy (`src/lib/templateVars.ts`) uses `VITE_APP_URL` (the Cloudflare build variable, a real public URL) so it does NOT have this bug; unchanged. Controller must set the `APP_PUBLIC_URL` secret (e.g. https://sales.didreamlabs.com). Until set, the first https entry of APP_ORIGINS is used, which is the production domain, and autopilot additionally refuses to send if the link is not https. |
| 7 Minors | `lastMinuteCheck` skips if the fresh enrolment differs from `ctx.enrollment` (id and step, or both absent: `sameEnrolment`); the advance is conditional (`.eq('id').eq('current_step', step).eq('status','active').select('id')`; zero rows is logged as `enrolment changed during send, left as is`, no failure and no follow up note); the repair update is wrapped in try/catch; `next_action_date` uses `localDateString(nextSendAt, run.timezone)`; per recipient guard: skip `This address was emailed in the last 14 days` when a `sent` email_logs row in the org to the same address (case insensitive, LIKE wildcards escaped) exists within 14 days, EXCEPT rows for this same lead when it is mid sequence (otherwise every follow up would be blocked; deliberate deviation); skip `This address belongs to a lead that opted out` when another opted-out lead in the org has the address. |
| 8 Order of safeguards | Extracted as pure `firstSendBlock(facts, reasonFor)` (order: lead missing, other org, classifyLead ineligible, recipient blocklisted, enrolment changed, opted-out address, recently emailed, candidate removed) with tests, and `lastMinuteCheck` now gathers facts then calls it. The order of reserve / insert draft / markSendStarted / send was left inline (extracting it would be a risky refactor of the send state machine). |

## Functions whose bundle changes (redeploy)

- `check-replies` (direct edit + ai.ts)
- `check-sequences`, `generate-email` (templateVars.ts unsubscribe base, ai.ts)
- `run-selected-autopilot` (the pipeline, selectedAutopilot.ts, ai.ts, templateVars.ts)
- Import ai.ts only (prompt text identical when new options are absent, so behaviour unchanged, redeploy optional but safest): `draft-linkedin-message`, `org-api-settings`, `parse-csv-leads`, `parse-icp`, `parse-notes`, `parse-session-notes`
- From the first commit still pending: `enrich-leads-bulk`, `find-decision-makers`
- `send-email` unchanged.

## Concerns

- The 14 day per address guard also blocks a legitimate second lead at the same business address; it parks as skipped with a plain reason.
- Greeting for the lead's own address uses the lead's owner name, which may be a different person than the mailbox owner (e.g. info@); that is unchanged behaviour from check-sequences.
- `APP_PUBLIC_URL` secret must be set; deployed functions read secrets on next cold start.

---

# Fix round 2 (commit "fix: autopilot link/domain checks, places-derived recipients, step-sent guard")

Checks: rules tests 80/80, full suite 510/510, `npx tsc --noEmit` clean, `--ignoreConfig` syntax check clean on all touched Deno files. No client src files changed, so no build.

1. Bare domains: `unexpectedLinksOrAddresses(templateText, finalText, allowed, ownWebsite?)` now extracts, in order, https URLs, email addresses (URLs removed first), then bare domains (`label(.label)+.tld`, 2+ letter TLD, optional `www.` and path) from what is left, so an email's domain part is never counted twice. `e.g.`, `i.e.`, `a.m.`, `p.m.` and `1.5` never match. A token is allowed only if it appears in the filled template text or the allowed list (appended links, attachment names, unsubscribe URL), compared case-insensitively with trailing punctuation and `www.` trimmed (paths compared exactly); or it is only the host of an allowed URL or the domain part of an allowed address; or it equals the registrable domain of the lead's own website (not if that is a free-mail domain). `draft.ts` passes the lead's website and attachment names. Known side effect: an unusual token such as `Dr.Smith` or `Node.js` also parks the draft (safe side).
2. Places-derived website: `placesDerivedWebsiteBlock` (pure, tested for candidate, foundEmail and leadEmail) parks with `Found a website and contact; please confirm they belong to this business before sending` for ANY recipient when the lead had no website and it was filled from `google_places` in this run. Fill-blank patches stay saved. Checked before the found-email domain rule in `recipient.ts`. Note the decision is the same for all three kinds, as requested.
3. Step-sent guard: `lastMinuteCheck` counts sent `email_logs` linked to the current enrolment id; `stepAlreadySent(count, current_step)` (count >= current_step) blocks with `This step was already sent to this address`, failing closed on a read error. The 14 day same-lead exemption still applies only while this guard passes. New fact `stepAlreadySent` in `firstSendBlock` (order: after enrolment changed, before opted-out address).
4. Suffixes and free mail: added `net.uk, sch.uk, nhs.uk, net.au, org.au` to the multi-part list (`com.au, co.nz, co.za` were already there); new `FREE_MAIL_DOMAINS` denylist (the 18 requested domains); a website or recipient on a free-mail domain never counts as a match.
5. `firstSendBlock`: one test per block reason (each alone yields that reason).

Redeploy: no new functions beyond round 1's list; `run-selected-autopilot` bundle changes again (rules, recipient, draft, send).

---

# Fix round 3 (commit "fix: harden autopilot link check, blocklist subdomains, free-mail list")

Only `_shared/selectedLeadPipelineRules.ts` and its test changed. Checks: rules tests 101/101, full suite 531/531, `tsc --noEmit` clean, syntax check clean.

1. Link check: `DOMAIN_RE` lookbehind is now `(?<![\w-])`, so `...evil.com`, `//evil.com`, `@evil.com`, `/evil.com` are caught (URLs and emails are removed first). Text is normalised before extraction (NFKC, ideographic and halfwidth full stops to `.`, zero width U+200B/C/D, U+2060, U+FEFF and soft hyphen U+00AD removed), so `evil。com`, `evil．com`, fullwidth letters and zero width or soft hyphen splits are caught; the same normalisation is applied to the template so a template domain written with zero width characters still matches. Still ignored: `e.g.`, `i.e.`, `a.m.`, `p.m.`, `1.5`, `9.30am`, `10.30am`, `U.K.`, `Ph.D.` (all tested).
2. Linear time: `EMAIL_RE` is bounded (`{1,64}` local part, `{1,63}` labels, at most 10 labels); `DOMAIN_RE` labels bounded `{1,63}` x `{1,10}`; end-anchored punctuation regexes replaced by bounded loops (`trimEnd`, `trimSlashes`). Perf tests (each under 200 ms): 60 KB of `a`, of `.`, of `a.`, `http://` plus 60 KB of dots, 60 KB of `a` then `@`, and 60 KB of commas.
3. `isRecipientBlocked`: a domain entry blocks the recipient's domain and every parent domain down to two labels (`evil.com` blocks `sub.evil.com`, case-insensitive); exact-email entries still work; look-alikes such as `notevil.com` are not blocked.
4. `FREE_MAIL_DOMAINS` gained ymail.com, msn.com, gmx.com, gmx.co.uk, ntlworld.com, outlook.co.uk, googlemail.co.uk, mail.com, zoho.com, fastmail.com, hey.com (tested).

Redeploy: `run-selected-autopilot` only (no other function imports this file's changed behaviour).
