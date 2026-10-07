# Task 10 report: sendLeadEmail extracted from send-email

Files: new `supabase/functions/_shared/sendLeadEmail.ts`; `supabase/functions/send-email/index.ts` now delegates.
Checks: tsc syntax check on both Deno files (no TS1xxx), `npx tsc --noEmit` clean, `npx vitest run` 241/241. Not deployed.

## Signature
`sendLeadEmail(service, { senderId, to, subject, body, leadId?, logId?, decisionMakerCandidateId?, attachments? })`
-> `{ ok: true; logId: string | null; warning?: string } | { ok: false; error: string; status?: number; logId?: string | null; warning?: string }`
Deviations from the brief signature (all needed for identical behaviour): `leadId` is optional/nullable (update-only calls send log_id with no lead_id and the original then writes lead_id = null); `logId` is `string | null` (original returns log_id null when the log insert fails); failure result carries optional `logId`/`warning` (the original "Send failed" response includes them); `status` is the HTTP status (always 400 today).

## Mapping (ORIGINAL send-email -> now)
| # | Original step | Now |
|---|---|---|
| 1 | OPTIONS / non-POST 405 | handler |
| 2 | auth via JWT, 401 "Not signed in" | handler |
| 3 | 400 "to_email, subject and body are required" | handler |
| 4 | service client creation | handler (passed to helper) |
| 5 | load user_email_settings; 400 "Set up and verify..." if not verified | helper (first step) |
| 6 | app_get_smtp_secret; 400 "No stored email password..." | helper |
| 7 | load lead (org_id, stage) when lead_id | handler (org_id only, for membership) AND helper (org_id + stage, second read) |
| 8 | 400 "lead_id is required to send a new email" (no org and no log_id) | handler (same position relative to membership) AND helper (defensive, for service-role callers) |
| 9 | org membership check, 404 "Lead not found" | handler only |
| 10 | draft load, 404 "Draft not found"; owner check (sent_by set and != user) 404; sent_by null => org-member check 404 | handler only |
| 11 | draftAttachments / draftOrgId captured from the draft | helper re-reads the draft (org_id, attachments) when logId given |
| 12 | parseAttachments (explicit list else draft's) | helper |
| 13 | 400 "Attachment not allowed" (org prefix / ..) and 400 10 MB limit | helper |
| 14 | download attachments before send, throw on failure | helper |
| 15 | sendMail with settings + Vault password | helper |
| 16 | SMTP/attachment failure -> status failed, error captured | helper |
| 17 | email_logs row (lead_id, sent_by, to_email, subject, body, status, error_message, message_id, sent_at, attachments) | helper |
| 18 | decision_maker_candidate_id only set when !== undefined | helper |
| 19 | org_id on row only when lead org known | helper |
| 20 | update existing row `.or(sent_by.is.null,sent_by.eq.<sender>)` or insert; log failure -> console.error + warning | helper |
| 21 | leads.last_contacted_at on success; stage new_lead -> contacted only | helper |
| 22 | failed send: 400 `{error:'Send failed: ...', log_id, warning?}` | helper returns {ok:false,status:400,logId,warning}; handler maps to same JSON/status |
| 23 | success: 200 `{ok:true, log_id, warning?}` | helper returns ok; handler maps to same JSON |
Gate errors (5, 6, 8, 13) keep their exact strings and 400, and their JSON has no `log_id` key (handler only adds it when result.logId is defined).

## Behaviour differences / oddities (please review)
1. ERROR PRECEDENCE CHANGE (only intentional deviation): originally the verified-settings and stored-password 400s came BEFORE the lead-membership 404 and draft-ownership 404. The brief requires those checks to stay in the handler and the settings gate in the helper, so now a non-member / non-owner with unverified settings gets 404 instead of 400. Error-only, no side effects, and arguably better (no existence leak). Preserving the old order exactly would need the handler to duplicate the settings/password gate.
2. Two extra DB reads per send (lead and draft are re-read inside the helper); same data, no behaviour change.
3. Oddities kept as-is: update-only calls (log_id, no lead_id) overwrite email_logs.lead_id with null; sent_at is set even for failed sends; a failed send leaves lead untouched; `.single()` draft read in the handler.
4. Helper JSDoc carries the loud "NO AUTHORIZATION" warning for service-role callers (verify lead belongs to the run's org, sender allowed, draft ownership).

## Fix round 1 (error order restored)

Corrections to the original report above: concern 1 there ("only intentional deviation", "arguably better, no existence leak") was wrong. There was a SECOND undeclared order change (an unverified-settings caller with no/missing lead_id and no log_id got "lead_id is required" instead of the settings 400), and the "no existence leak" claim was false (the old order did not leak anything the new one hides; it was simply a different order). Both differences are now gone.

Change: `_shared/sendLeadEmail.ts` exports `loadSenderMailbox(service, senderId)` (the only place the two gate messages live). The handler calls it right after creating the service client, before the lead read, and returns its error as `json({ error }, status)` exactly as before. It then passes `mailbox`, and the already-read `orgId`, `leadStage` and `draft` ({org_id, attachments}) into `sendLeadEmail`, which skips those reads when they are supplied and reads them itself otherwise (engine use); it also calls `loadSenderMailbox` itself when `mailbox` is omitted. Helper now returns 404 "Draft not found" if a supplied logId has no draft row (unreachable from send-email except on a race).

Early returns of the ORIGINAL, in original order, and where each lives now (order preserved):
1. 405 non-POST: handler, first
2. 401 Not signed in: handler
3. 400 to_email/subject/body required: handler
4. 400 "Set up and verify your email..." : handler via loadSenderMailbox (still before any lead read)
5. 400 "No stored email password..." : handler via loadSenderMailbox (immediately after 4)
6. 400 "lead_id is required..." : handler, after lead read (helper keeps a defensive copy that cannot fire for send-email)
7. 404 "Lead not found" (non-member): handler
8. 404 "Draft not found" (no row): handler
9. 404 "Draft not found" (sent_by other user): handler
10. 404 "Draft not found" (sent_by null, non-member): handler
11. 400 "Attachment not allowed": helper (first thing after the handler checks)
12. 400 10 MB limit: helper, right after 11
13. send / failure / log write / lead update / responses: helper, then handler maps to the same JSON and status
The unchanged-order walk against send-email-original.ts shows 4,5 -> 6 -> 7 -> 8-10 -> 11-12 exactly as the original. The helper no longer re-reads the lead or draft when called from send-email (no extra reads, no race window).

Checks (foreground, one at a time): --ignoreConfig syntax check on both files, no TS1xxx; `npx tsc --noEmit` clean; `npx vitest run` 241/241. Not pushed, not deployed.
