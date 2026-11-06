# Fix brief: bounce backfill extracted 0 addresses from 13 real bounces (Claude live test, 2026-11-06)

Builder: Codex. Reviewer: Claude. Director: Kevin. Roles unchanged. Branch: `git switch -c codex/email-outcome-backfill-fix` from the current checkout (equals `main` 312d0f4, live and deployed). Tests first, one commit per item, no push, merge, deploy or secrets, no migration, no worker change. Commits `git -c core.hooksPath=NUL commit`, ending `Co-Authored-By: Codex <noreply@openai.com>`. Stop after the report addendum (new section at the END of `docs/EMAIL-OUTCOME-LEARNING-BUILD-REPORT.md`).

## What the live run showed
Kevin ran `email-settings {"action":"backfill_bounces"}` as the sending mailbox (all 120 emails of 2026-11-05 were sent from it). Result: `messages_read 97, bounces_found 13, recipients_extracted 0, matched 0, unmatched 0`. So bounces are recognised, but no failed recipient is ever extracted, and no outcome is written. Synthetic fixtures passed; real Gmail bounces do not.

## Real Gmail bounce, anonymised (use as the test fixture; addresses are fake)
Top-level headers:
```
From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>
Subject: Delivery Status Notification (Failure)
Auto-Submitted: auto-replied
Content-Type: multipart/report; boundary="B0"; report-type=delivery-status
In-Reply-To: <sent-id-1@gmail.com>
References: <sent-id-1@gmail.com>
X-Failed-Recipients: person@example.com
```
Parts, in order:
1. `multipart/related` > `multipart/alternative` > `text/plain` containing: `** Address not found **` / `Your message wasn't delivered to person@example.com because the address couldn't be found, or is unable to receive mail.` / `The response was:` / `550 5.2.1 The email account that you tried to reach is inactive. For more information, go to https://support.google.com/mail/?p=DisabledUser <id> - gsmtp`; then a `text/html` twin; then an `image/png` attachment (`Content-ID: <icon.png>`).
2. `Content-Type: message/delivery-status` whose body is EMPTY in the raw source we were shown (no `Final-Recipient`, no `Status` lines). The parser must not fail or give up because this part is empty or missing.
3. `Content-Type: text/rfc822-headers` containing the ORIGINAL message headers: `To: <person@example.com>`, `Message-ID: <sent-id-1@gmail.com>`, `Subject: ...`, `From: Mr Brush & Co <sender@gmail.com>` (headers only, no body).

## Causes to confirm with failing tests first (Claude read the 13-bounce result, not the code; verify each)
1. Status class: the only status text is `550 5.2.1` (mailbox disabled/inactive). Part A's rules count only 5.1.1, 5.1.10 and "user unknown/mailbox not found" wording, so this bounce is classified "not hard" and the recipient is dropped before extraction is even counted. 5.2.1 with a 5xx reply is permanent: the address cannot receive our mail.
2. Recipient sources: the only reliable places in a Gmail DSN are the top-level `X-Failed-Recipients` header, the `To:` of the `text/rfc822-headers` part, and the sentence "Your message wasn't delivered to X" in the text part. The empty `message/delivery-status` part gives nothing. Check which of these the adapter exposes; make the extractor use all of them, in that priority, and require the extracted address to equal the `To:`/recipient of our own matching sent log before accepting it (this keeps forged DSNs from naming arbitrary addresses).
3. Matching: the DSN carries our sent Message-ID in `In-Reply-To`, `References` and the returned headers' `Message-ID`. Confirm how `email_logs` stores our Message-ID (with or without angle brackets, lowercase or not) and that the lookup normalises both sides. If the sent log has no stored Message-ID for these sends, say so plainly and fall back to the unthreaded rule (one lead/org, sent within 30 days to that exact address).

## Items (tests first, one commit each)
1. Fixture test with the DSN above (build the MIME in the test): expect hard bounce, recipient `person@example.com`, matched to the sent log row. Also a second fixture with `Final-Recipient` and `Status: 5.1.1` present (the old synthetic path) to prove nothing regressed.
2. Hard-status rules. Add as hard when the reply is permanent (5xx / status 5.x.x): 5.2.1 (disabled/inactive mailbox), 5.1.2 (domain does not exist / bad destination), 5.1.3 (invalid address), 5.1.6 (mailbox moved/gone). For Microsoft 365 `550 5.4.1 Recipient address rejected: Access denied`: count as hard (recipient does not exist in that tenant, and either way we cannot deliver); say so in the report. Keep NOT hard: 5.2.2 (mailbox full), 5.2.3 (message too large), 5.3.x, 5.7.x (policy/spam/blocked sender), 4.x.x, auto-replies, out-of-office, delayed-delivery notices. Add one test per code.
3. Recipient extraction from `X-Failed-Recipients`, `text/rfc822-headers` `To:` and the "wasn't delivered to X" sentence, validated against the matching sent log. Multiple failed recipients in one DSN are independent. An empty or malformed `message/delivery-status` part is tolerated. Tests: each source alone, empty status part, forged DSN naming an address we never sent to (must be unmatched, not recorded).
4. Diagnostics so a future miss is visible without reading mail: extend the backfill counts with `by_reason` (counts only, never addresses or bodies): `hard`, `soft_status`, `no_recipient_found`, `no_status_found`, `recipient_not_in_sent_log`, `message_id_not_found`, plus `status_codes` as a map like `{"5.2.1": 9, "5.1.1": 3}`. Keep the existing fields. Test the counts.
5. After the fixes, run the backfill logic locally over a bounded set of fixture DSNs only. Do not read any real mailbox.

## Deploy list and gates
`email-settings`, `check-replies`, and any function importing the changed shared files (list them from the import graph). No migration, no frontend change expected. Gates: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs` with `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-test-placeholder`.

## Privacy
No real recipient addresses, company names or message bodies in tests, docs, logs or commits. Use `example.com` only.
