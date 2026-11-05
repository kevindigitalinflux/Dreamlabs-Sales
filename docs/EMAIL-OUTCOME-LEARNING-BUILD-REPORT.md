# Email outcome learning — local build report

Kevin authorised Parts A, B and C in order, tests first, one commit per numbered item, with no publication or migration application. Codex remains builder and Claude reviewer. Start: clean `04c28be93dac7c0207b6fe0a7dbcf75b8e0956f6`, equal to origin/main; local main was older and was not reset. Created `codex/email-outcome-learning` from origin/main in `dreamlabs-sales-accuracy`, as the closing scope update requires. Subscription usage is unavailable; no percentage or paid fallback is asserted.

## Part A item 1 — local implementation, review pending

Before this change `automaticMail` classified bounces and `recordBounce` counted them, but neither extracted failed recipients. PostalMime already exposes decoded delivery-status attachments; the adapter now retains bounded DSN text and original returned-message Message-ID headers for learning. The unrelated original body is never passed to outcome storage. Parser design follows the per-recipient blocks in [RFC 3464](https://www.rfc-editor.org/rfc/rfc3464.html). No production mailbox or real DSN was read during this build.

Synthetic anonymised header examples tested: `Final-Recipient: rfc822; missing@example.com`, `Original-Recipient: rfc822; missing@example.com`, and `X-Failed-Recipients: missing@example.com`, paired with `Status: 5.1.1`, `5.1.10` or an explicit nonexistent-mailbox diagnostic. Soft status 4.x.x, mailbox-full 5.2.2, policy failure 5.7.1, delayed action, greylisting and auto-replies do not invalidate addresses. Recipient blocks are independent; a missing forwarded target does not invalidate a different original address. Ambiguous or unsupported formats remain unmatched rather than guessed.

Learning matches only this mailbox's actual sent logs, within 30 days and the latest 1,000 rows, validates lead/org membership, and uses original Message-IDs where available. Unthreaded matches must resolve to one lead/org. One DSN admits at most 100 extracted recipients and 20 lead links; overflow stays unmatched. DSNs remain forgeable mail, not cryptographic delivery proof; sent-log/thread matching reduces poisoning but cannot authenticate a mail server. Human-reply evidence uses the existing thread/sender guard. Outcomes are saved before reply deduplication so a transient outcome failure leaves the UID retryable.

The service-only transaction below records the exact address, pauses all currently active enrolments for that lead only when the existing `planStepDrafts` recipient policy includes it, and adds one plain lead note. It reuses the existing `paused` path rather than inventing a new sequence status. Retrying the same outcome transaction does not duplicate its note. Suppression and note effects commit with the outcome. A later human recipient edit can race the application-side recipient snapshot; the current send guard in Part B must independently consult hard-bounce evidence.

Targeted local evidence so far: 35 tests pass across DSN rules, mailbox matching, MIME and reply orchestration; the 25-entrypoint edge type shim passes. SQL/RLS/transaction behavior remains unexecuted and needs Claude review. Do not deploy code that requires this table/RPC before the approved migration is applied. Parts A2-A4, B and C remain unfinished at this checkpoint.

## One proposed migration — SQL for review only, NOT applied

This is the only proposed new table. The three `checked_*` values reserve the approved Part B cache in the same migration. Membership permits org-scoped reads; only service_role may write trustworthy evidence. Addresses, domain, outcome, source identifier, timestamp and source lead are stored; no DSN or reply body. Lead/org deletion cascades. One org/address/outcome row has one source-lead association; when an address belongs to multiple leads, deleting its associated source lead removes that evidence, conservatively requiring a later recheck. No cross-org cache exists.

```sql
BEGIN;
CREATE TABLE public.email_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  address text NOT NULL CHECK (
    address = lower(btrim(address)) AND length(address) BETWEEN 3 AND 254
    AND address !~ '[[:cntrl:]]'
    AND address ~ '^[^[:space:]@<>,;:]+@[^[:space:]@<>,;:]+\.[a-z]{2,}$'
  ),
  domain text GENERATED ALWAYS AS (split_part(address, '@', 2)) STORED,
  outcome text NOT NULL CHECK (outcome IN (
    'bounced_hard','replied','checked_invalid','checked_valid','checked_unverifiable'
  )),
  source_message_id text NOT NULL CHECK (length(source_message_id) BETWEEN 1 AND 250),
  seen_at timestamptz NOT NULL,
  UNIQUE(org_id,address,outcome)
);
CREATE INDEX email_outcomes_domain_seen ON public.email_outcomes(org_id,domain,seen_at);
ALTER TABLE public.email_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outcomes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.email_outcomes TO authenticated;
GRANT ALL ON public.email_outcomes TO service_role;
CREATE POLICY email_outcomes_org_read ON public.email_outcomes FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = email_outcomes.lead_id AND l.org_id = email_outcomes.org_id
  ));

CREATE FUNCTION public.record_email_outcome(
  p_org_id uuid, p_lead_id uuid, p_address text, p_outcome text,
  p_source_message_id text, p_seen_at timestamptz,
  p_pause_sequences boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  clean_address text := lower(btrim(p_address));
  note_text text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id AND org_id = p_org_id)
    OR p_seen_at IS NULL OR p_seen_at > now() + interval '5 minutes'
  THEN RAISE EXCEPTION 'Invalid email outcome scope or time'; END IF;

  -- The unique-row lock serialises repeated effects for the same address and outcome.
  INSERT INTO public.email_outcomes(org_id,lead_id,address,outcome,source_message_id,seen_at)
  VALUES(p_org_id,p_lead_id,clean_address,p_outcome,p_source_message_id,p_seen_at)
  ON CONFLICT (org_id,address,outcome) DO UPDATE SET
    seen_at = greatest(email_outcomes.seen_at,EXCLUDED.seen_at),
    source_message_id = CASE WHEN EXCLUDED.seen_at > email_outcomes.seen_at
      THEN EXCLUDED.source_message_id ELSE email_outcomes.source_message_id END;

  IF p_outcome = 'bounced_hard' THEN
    IF p_pause_sequences THEN
      UPDATE public.sequence_enrollments SET status = 'paused'
      WHERE lead_id = p_lead_id AND status = 'active';
    END IF;
    note_text := 'Email to ' || clean_address || ' bounced: address does not exist';
    INSERT INTO public.lead_notes(lead_id,created_by,note_type,content)
    SELECT p_lead_id,NULL,'general',note_text
    WHERE NOT EXISTS (SELECT 1 FROM public.lead_notes WHERE lead_id = p_lead_id AND content = note_text);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_email_outcome(uuid,uuid,text,text,text,timestamptz,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_outcome(uuid,uuid,text,text,text,timestamptz,boolean)
  TO service_role;
COMMIT;
```

Security validation required before rollout: real org-member/nonmember RLS checks, service-only RPC grants, mismatched lead/org refusal, per-address concurrent retries, note idempotency, timestamp monotonicity, and cascaded deletion. Run fixture writes only against a disposable local database, not production. No migration file, SQL execution or live state change occurred in this item.

Current deploy scope: `check-replies` imports the modified polling/MIME modules. Later parts will expand the manifest. No deployment is authorised. Changed files and final gate counts will be consolidated at each part boundary.

## Part A item 2 — bounded backfill (local)

Tests first: the backfill suite failed because the module was absent. The authenticated email-settings action backfill_bounces now scans only the caller's connected INBOX, from the last 30 days. It admits at most 200 newest UIDs per call, fetches one bounded message at a time, and has a 100-second deadline. Counts include messages_read, bounces_found, recipients_extracted, matched and unmatched; capped/complete and next_before_uid expose partial progress. Repeat with before_uid set to that cursor to cover older mail. Repeating without a cursor is safe: the proposed unique outcome transaction and note deduplication remain authoritative. No alerts, optional drafts, sends, discover-run bounce increments or normal mailbox watermark writes are repeated by backfill.

Message receipt time comes from IMAP INTERNALDATE, not an untrusted Date header. Missing Message-IDs can use mailbox UIDVALIDITY plus UID as stable source provenance; without either provenance source, the recipient stays unmatched. Normal polling now uses the same UID provenance and receipt time. Search is INBOX-only: archived, spam, deleted, unsupported or oversized mail is not guaranteed coverage. A search may return more UIDs than are parsed; the 200 limit applies to fetched/parsed messages. A failure returns a safe error and permits an idempotent retry; no raw body, credential or server error enters logs. The SQL/RLS remains proposed only, so the local idempotency test uses a fake durable-store model rather than a live transaction.

Targeted A1/A2 suites: 42 tests pass; edge shim and whitespace pass. Endpoint tests cover caller-only mailbox selection despite supplied foreign user/org, signed-out access, missing connection and invalid cursor. Backfill tests cover double execution, 205-message truncation, stable source IDs, auto-replies and cleanup after parse failure. Proposed invocation after review/migration/deploy: call email-settings with an authenticated caller and JSON {"action":"backfill_bounces"}; continue with {"action":"backfill_bounces","before_uid":<next_before_uid>}. This build did not invoke it against a real mailbox. Deploy manifest now also includes email-settings. Parts A3/A4, B and C remain unfinished.

## Part A item 3 — derived domain warning (local)

A failing import-free test suite first specified three distinct hard-bounced addresses within fourteen days, excluding other organisations, expired rows, other outcomes and other domains. The Contacts card now shows “Several addresses at this domain bounced: check the format” for affected email/site domains. Each read explicitly filters org, domain, hard-bounce outcome and receipt cutoff and requests an exact count rather than a truncated row list; the table's unique org/address/outcome key makes that a distinct-address count. No aggregate, warning field or additional table is persisted. Loading, failed-read and no-warning states are handled; an organisation/domain change hides stale results. No realtime publication was added. Refreshing the card rereads the signal. Two rule tests pass, TypeScript and whitespace pass; browser/phone/theme and live RLS behavior remain unverified. This item adds frontend deployment to the manifest. Parts A4, B and C remain unfinished.

## Part A item 4 — engine evidence, privacy and Part A boundary

Tests first: the new real-engine hard-bounce/reply cases failed because the worker still checked those exact addresses. Deep find now reads exact org/address outcomes before saved-email checks, generated checks, contact fills/inserts and final suggestion output. A hard bounce wins over any reply and removes that address with “This address bounced before.” A validated human reply supplies a valid verdict with “This address has replied before.” Known evidence is not a new worker attempt and spends no worker or guess allowance. Unaffected addresses retain the existing checker flow. Missing exact-outcome storage fails closed; it is not interpreted as no previous bounce. Final failure output also declines suggestions when their outcome history cannot be read.

Confirmed replies feed domain format inference and the existing distinct-person Pattern-supported tier as independent evidence. They cannot count if the same address also has a hard bounce. Truncated, uncounted or greater-than-50-address reply samples decline the optional confidence bonus instead of hiding conflicting patterns; exact-address safety reads remain independent and untruncated (at most the five unique outcome values). The confidence label says known addresses when replies participate, preserving the distinction between a private reply and a public scrape. Generated worker-valid guesses remain excluded from independent publication evidence. A new engine regression proves two genuine reply addresses support a third person's format even with the worker unconfigured. Synthetic bounce notes are excluded from human-note drafting input.

Part A's proposed SQL remains solely in this report and is NOT applied. It has one new org-scoped table, member reads only, service-only writes/RPC, source-lead/org cascading deletion and no message bodies. Same-address evidence across leads has the single-source-lead deletion limitation recorded above. No cross-org learning/cache exists. No migration file or security policy was applied. SQL grants, RLS, transaction locking/idempotency and deletion remain Claude/local-database review work, not proven by these application fakes.

Part A complete locally: A1 8887075, A2 aa0dcf9, A3 29ab209; A4 contains this addendum. Full suite: 2,942 passed, one skipped, zero failures. TypeScript, production build (2,945 modules, existing chunk warning), 25-entrypoint edge shim and whitespace pass. Last targeted engine/evidence group: 202 passed. Dummy localhost Supabase values only. Changed application files: emailOutcomeRules.ts, emailOutcomeLearning.ts, emailOutcomeBackfill.ts, emailOutcomeSignals.ts, emailOutcomeLookup.ts, replyImap.ts, replyPolling.ts, deepFind.ts, personEmailFinding.ts, sequenceRecipients.ts, email-settings/index.ts, DomainBounceWarnings.tsx and DecisionMakersCard.tsx, plus their local tests/test double. No dependency or worker/VPS edit, provider call, secret, SQL execution or publication occurred. Independent review and real DSN/mailbox/RLS/browser checks remain pending.

Next authorised work is Part B1, then B2-B5, then C1-C4. No Part B or C implementation is claimed by this boundary. Known hard bounces must also be blocked at the actual send boundary in Part B; do not deploy Part A alone as a complete send-safety solution. The cumulative deployment manifest will include check-replies, email-settings, engine/shared importers and frontend, plus Part B send paths. Current scope remains local build only.

## Part B item 1 — shared pre-send checker and fourteen-day cache

Tests first: new checker and SMTP-boundary suites failed before the module/boundary existed. The shared sendLeadEmail boundary now checks every real send path, including selected Autopilot, before SMTP. Exact hard-bounce history is reread before even a warm valid result is reused; a hard bounce blocks, and a genuine reply confirms. Recent checked_invalid/checked_valid/checked_unverifiable outcomes reuse the same proposed table for fourteen days. A small operation-local map avoids repeated successful checks; transient worker failures and time/pacing skips are not durable cached checks. Real checker replies are saved with minimal check provenance through the same service-only RPC; a failed cache write preserves the immediate verdict and warns rather than treating an invalid address as safe. Drafts without a lead association cannot persist a lead-owned cache row and use an operation-local result only.

Checks go through existing workerClient reservation/refund handling and RunVerifyGate, with a full 33-second call window. Send-gate state is org-scoped within a warm edge isolate and expires after 120 seconds idle; independent isolates still rely on the worker's own domain rate limiter. This is deliberately not a claimed durable cross-isolate send-run gate; no Deep find state row is invented and no extra gate table is created. The persistent address result cache remains org-scoped. Checker unavailability is Not confirmed and permits sending; inability to read past hard-bounce evidence fails closed. Selected Autopilot passes its remaining lead time minus a 15-second SMTP/save margin, so checks do not acquire a fresh 110-second allowance after research. An invalid result blocks without sending. This item does not yet add the row override or frontend labels/counts (B2), free checks (B3), quota label/constants (B4) or final release regressions (B5).

Eleven new/existing checker-boundary-SMTP tests pass; the edge shim passes. No mail, provider or SQL action ran. SQL checked_* values were already included in the single proposed Part A migration. Deploy manifest expands to send-email and every shared sender importer, including run-selected-autopilot. Final Part B full gates remain pending.

## Part B item 2 — labels, blocked release and explicit row override

New failing SMTP-boundary and response/view tests first required an explicit override and correct handling of non-2xx blocked metadata. send-email now returns verification details on both success and rejection. The shared boundary accepts a strict human override only for that request's recipient; hard-bounce evidence remains non-overridable. Existing authentication/lead/draft checks still run first. The composer presents a separate explicit confirmation naming the exact recipient after a checker block; it never silently retries a blocked row. Bulk release never overrides: open that row for individual review. Syntax blocks will also be non-overridable in B3.

Queue/composer badges derive from org-scoped cached outcomes, with exact-count completeness checks in batches of twenty addresses. They default to Not confirmed and never claim a stale/foreign check is valid; errors are visible. They do not reserve worker checks merely by opening the page. Server checking remains authoritative on release. Fresh drafts cause cache display rereads; no new realtime publication was added. The composer keeps unconfirmed-success results open for the rep to read. Bulk and individual results separately count sent, blocked, not confirmed and failed. Not confirmed counts actual sends lacking a valid check, including an explicitly overridden checker block; blocked is not counted as sent or as an SMTP failure. Non-2xx details are read from a cloned Response so existing error handling still works.

Nineteen targeted checker/override/response/endpoint tests pass; TypeScript, edge shim and whitespace pass. Actual browser interactions, focus, phone width and explicit native-dialog behavior are unverified. No email was sent. B3-B5 and C remain unfinished; no production action or SQL application is authorised.
