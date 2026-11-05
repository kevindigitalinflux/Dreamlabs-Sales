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
    lead_id = CASE WHEN EXCLUDED.seen_at > email_outcomes.seen_at
      THEN EXCLUDED.lead_id ELSE email_outcomes.lead_id END,
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

-- Expose only the derived warning, not another pipeline's private source addresses.
CREATE FUNCTION public.email_domain_bounce_warnings(p_org_id uuid,p_domains text[])
RETURNS TABLE(domain text) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF public.is_org_member(p_org_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_domains),0) > 40 OR EXISTS (
    SELECT 1 FROM unnest(p_domains) AS requested(value)
    WHERE value IS NULL OR length(value) NOT BETWEEN 1 AND 253 OR value !~ '^[a-z0-9.-]+$'
  ) THEN RAISE EXCEPTION 'Invalid domain request'; END IF;
  RETURN QUERY SELECT e.domain FROM public.email_outcomes e
    WHERE e.org_id = p_org_id AND e.domain = ANY(p_domains)
      AND e.outcome = 'bounced_hard' AND e.seen_at >= now() - interval '14 days' AND e.seen_at <= now()
    GROUP BY e.domain HAVING count(DISTINCT e.address) >= 3;
END;
$$;
REVOKE ALL ON FUNCTION public.email_domain_bounce_warnings(uuid,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_domain_bounce_warnings(uuid,text[]) TO authenticated;
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

## Part B item 3 — free syntax, MX and typo checks

Three tests failed first for malformed syntax, no-MX blocking and unchanged typo recipients. Supported ASCII syntax, local-part/dot bounds and DNS-label rules now reject malformed recipients without DNS or worker requests; syntax rejection cannot be overridden. The existing fixed-endpoint DNS-over-HTTPS helper now optionally admits recognised free-mail providers while preserving hostname/private-host restrictions. Existing NXDOMAIN, empty-answer and null-MX parsing supplies invalid; DNS/network failure is not evidence of absence and continues to the worker. No recipient domain itself is fetched. No-MX results use the existing checked_invalid cache; obvious Gmail/Outlook/Hotmail/Yahoo typos add a warning and never rewrite the address. Warning disclosure survives cached results. Fourteen-day cache reuse remains as specified.

Twenty targeted syntax/MX/checker/override/view/SMTP tests pass; TypeScript, edge shim and whitespace pass. The DNS tests stub fetch and verify both the fixed endpoint and the free-mail/private-host boundaries. A legacy SMTP test initially lacked a DNS stub after this integration and may have attempted a fixture.invalid DNS-only lookup; it now explicitly stubs DNS. No real recipient, credential, SMTP or lookup-worker request was involved in that test. Live DNS/provider behavior was not validated. B4/B5 and C remain unfinished.

## Part B item 4 — allowance disclosure and approved quota defaults

Failing tests first required 600 org / 1,200 shared daily checks, allowed sending on quota refusal, and a visible release disclosure. usageRules.ts now mirrors those approved defaults; existing custom-limit meter fixtures remain valid. A reservation refusal returns Not checked: daily check allowance reached, remains unconfirmed and permits the reviewed send. That refusal is never stored as a fourteen-day checked result, so a later allowance reset can trigger a real check. Both composer and bulk summaries preserve the disclosure rather than reducing it to a count. Worker reservation/refund code is unchanged. Claude's supplied live quota change is not independently re-read or executed by this build. Sixty-six targeted pre-send/view/usage/client tests pass; TypeScript, edge shim and whitespace pass. B5 full integration/gates and C remain unfinished.

## Part B item 5 — real-client release regression and Part B boundary

The new release regression first failed before its explicit test worker factory was wired. Its fixture RPC names were corrected to the existing usage_reserve/usage_refund names before accepting results. It now runs 120 distinct recipient domains through the actual prechecker, worker client, run gate, usage helpers, shared sender and response summary, with DNS/fetch/SMTP/database effects replaced by local doubles. It proves every request reserves before fetch: 120 verifier requests, 120 reservations, 30 refunds for worker-unreachable/no-work responses, 30 invalid recipients blocked, 90 emails reaching fake SMTP, and 60 sends explicitly not confirmed (30 unknown verdicts, 30 unavailable checks). Before this feature all 120 would have reached SMTP without this pre-send attempt. These counts distinguish attempted checks from confirmed addresses; unknown is never promoted to valid. No real network or SMTP request occurs in this regression.

Parts A and B are complete locally. Part B commits: d7a9667 (B1), 6376090 (B2), bb72755 (B3), 8443eba (B4); B5 contains this addendum. Current full suite: 2,963 passed, one skipped, zero failures. TypeScript, production build (2,949 modules, existing chunk warning), 25-entrypoint edge shim and whitespace pass. The SQL remains only the proposed single-table/RPC migration in this report and has not been applied. Source cache writes, RLS, SMTP/provider latency and browser review/override interactions remain unverified in production. No publication, SQL, secret or worker/VPS change occurred. The earlier possible fixture-domain DNS request is disclosed under B3; no real-recipient lookup was involved.

Next authorised work is C1 caps/text, C2 bounded transient retry, C3 role-mailbox honesty, C4 measured effect/final report. No Part C behavior is claimed at this boundary. Deployment remains blocked on Claude's independent review, Kevin's migration approval/application, and separately authorised function/frontend rollout. Missing migration storage fails closed rather than sending past an unreadable hard-bounce history.

## Part C item 1 — approved stronger-verifier caps

Failing cap and rendered-confirmation tests first required ten checks per lead, eight per guess domain, and 600 checks in the confirmation text. Those constants and EFFORT_DAILY_LIMITS.checks are now updated; usageRules already mirrors 600/1,200 from B4. Worker-side five-per-minute and gate four-start sliding-window pacing are unchanged; no VPS, live resource row or reservation/refund rule changed. The existing five-person prioritisation slice and fixed common formats remain; the higher cap creates more available attempts, not a promise to complete all eight within a lead's deadline.

The cap increase intentionally changes several fake-worker counts: a UKRM fixture now checks six rather than five addresses before its existing unverifiable stop; another checks eight rather than five. Formats newly proven invalid disappear instead of remaining guesses, so those assertions now require only unchecked remaining formats. The later-Microsoft-format fixture exhausts Alex's remaining formats rather than retaining a known-invalid suggestion. All 298 targeted worker/guess/effort/engine tests pass; TypeScript, edge shim and whitespace pass. C2-C4 remain unfinished.

## Part C item 2 — one bounded non-hosted transient retry

Failing fake-clock tests first required unknown/timeout recovery after sixty seconds. Deep find and pre-send checking now enable one retry only when the DNS provider classification positively remains non-hosted/unknown. It waits at least sixty seconds AFTER the first answer, then requires a fresh full 33-second call window plus two seconds inside the caller's remaining budget. Catch-all, provider-block and hosted answers are never retried. A missing provider classification declines retry rather than assuming non-hosted. A second unknown/timeout cannot trigger a third request.

Unknown results release the domain lease during the wait, allowing another address to use the domain. A timeout keeps its breaker; only the original request's opaque retry-owner token may bypass that timeout once, and provider-block/hosted or another request's breaker cannot be cleared. Ownership and blocked-reason metadata use the existing gate JSON and compare-and-swap, with no new schema. Actual retry starts still pass the four-per-minute rolling gate and worker's own limiter. The retry consumes one logical address slot/tally, but BOTH physical worker requests reserve daily usage independently; no fake refund hides a dispatched first timeout. This distinction preserves reservation/refund rules and the real worker load.

Timing limitation: a client timeout at 33 seconds plus the required 60-second delay plus another full 33-second window and two-second reserve needs 128 seconds. It therefore cannot retry inside the actual 120-second Deep find lead or 110-second pre-send share; it remains a timeout with the existing reason. Earlier worker-reported timeouts and fast unknown replies may fit. The preserved 25-second people reserve also prevents a one-second unknown guess from fitting a 96-second retry admission into a fresh 95-second guess share. Saved/published checks and pre-send checks have more room. The implementation does not borrow reserves or shorten a required call to conceal these limits.

Eight retry cases cover unknown recovery, actual client timeout under a hypothetical 130-second allowance, hosted/refusal suppression, insufficient time, no third attempt, released unknown leases and wrong-owner refusal. Combined retry/gate/client/engine/release group: 228 tests pass. TypeScript, edge shim and whitespace pass. No real worker latency or retry was exercised. C3/C4 remain unfinished.

## Part C item 3 — role-address honesty

Failing pure and engine tests first required the seven named role prefixes, hosted/catch-all labels and no false readiness. info/hello/contact/office/enquiries/admin/sales mailboxes on hosted or catch-all domains now show Role address, not confirmed. Deep find excludes their SMTP-only acceptance from verified-email readiness, paid-phase success shortcuts and format evidence; automatic lead-email selection and contact blank-fills/inserts retain them as review suggestions instead. Existing manually saved primary addresses are not erased. Named-person addresses keep their previous independent validation behavior. The engine currently has no automatic company-email primary fill, but that generic apply path is guarded too.

Pre-send checks apply the same role policy, including reclassification of older role cache entries after MX/provider lookup, and cache hosted role acceptance as checked_unverifiable. Review badges label unchecked/unverifiable role addresses plainly. A genuine human reply remains stronger evidence and retains This address has replied before; even then Deep find does not automatically select a hosted role inbox as primary. Invalid verdicts still block, and the daily-allowance disclosure is preserved rather than overwritten by a role label.

Twelve new role cases cover all prefixes, non-hosted/named exceptions, hosted/catch-all discovery, readiness and the real-reply exception. The combined role/engine/pre-send/view/discovery group passes 243 tests; TypeScript, edge shim and whitespace pass. No production role-mailbox probe occurred. C4 measured comparison and final report remain.

## Part C item 4 — measured comparison and final handoff

All thirteen ordered items (A1-A4, B1-B5, C1-C4) are complete locally. C4 contains the final report/checkpoint. The final fake-worker comparison uses 120 distinct addresses across 60 domains, one-second answers, and the actual prechecker/client/gate/usage/shared-send path. Fetch, DNS, SMTP and database writes are local doubles. Each result category has 30 addresses: invalid, valid, initially unknown, and unavailable worker. With retry enabled, the unknown group returns valid on its one retry. This is a controlled fixture, not a measured production bounce-rate improvement.

| Metric | Original no-precheck counterfactual | Part B policy, no retry | Part C bounded retry |
|---|---:|---:|---:|
| Intended recipients | 120 | 120 | 120 |
| Physical verifier requests / reservations | 0 | 120 | 150 |
| No-work refunds | 0 | 30 | 30 |
| Invalid recipients blocked | 0 | 30 | 30 |
| Emails reaching fake SMTP | 120 | 90 | 90 |
| Sent without any pre-send attempt | 120 | 0 | 0 |
| Sent without a completed checker answer | 120 | 30 | 30 |
| Sent after a completed but inconclusive answer | 0 | 30 | 0 |
| Sent without confirmation | 120 | 60 | 30 |
| Checker-confirmed sends | 0 | 30 | 60 |

The original column is inferred from the baseline sender's absence of pre-send verification and these entirely uncached fixture addresses; it is not an executed old production run. The two feature columns are directly asserted in the fake-worker suite. Unavailable-worker requests do no verification work: they are NOT called checked/confirmed merely because HTTP was attempted. These 30 sends intentionally remain allowed and labelled Not confirmed under Kevin's rule. No claim is made that SMTP-valid guarantees future delivery. A recovered unknown needs roughly 62 seconds in this one-second-response fixture (first answer, sixty-second delay, second answer); serial releases can therefore take substantially longer.

Final review also added failing-before regressions for raw trailing CRLF before normalisation, and usage-service failures being mislabelled as exhausted quotas. Syntax now rejects raw line breaks; worker results distinguish actual quota refusal from failed accounting without changing reservation/refund behavior. A final privacy review found that lead visibility RLS could hide source rows from a rep's direct domain-count query. The Contacts warning now uses the proposed membership-checked email_domain_bounce_warnings aggregate RPC in the SAME migration SQL above. It returns only requested domains with at least three distinct hard bounces in fourteen days, not hidden lead identities or addresses. Requests are bounded to forty domains server-side and twenty per client batch. The raw-outcome read policy remains visibility-constrained. Two read-boundary tests cover org arguments, batching, failures and unexpected returned domains. The proposed recording RPC's source-lead association follows a strictly newer event alongside its source identifier; its single-source deletion limitation still applies. Neither RPC nor the table was executed.

### Final gates and deployment manifest

Final full suite: **2,989 passed, one skipped, zero failures**. npx tsc --noEmit passes. npm run build passes (2,949 modules, existing chunk-size warning). git diff --check passes. The standard node scripts/places-edge-typecheck.mjs passes 25 entrypoints; an additional ignored local config includes enrich-apollo, enrich-hunter and parse-icp and passes 28 entrypoints, covering the full conservative import manifest. Full tests/build used VITE_SUPABASE_URL=http://127.0.0.1:54321 and VITE_SUPABASE_ANON_KEY=local-test-placeholder. No dependency/manifest/lockfile change. The brief's required gates are all green.

Static relative-import traversal yields this conservative 23-function rollout union (not deployment authorisation): check-replies, check-sequences, draft-linkedin-message, draft-reply, email-settings, enrich-apollo, enrich-hunter, enrich-leads-bulk, find-decision-makers, generate-email, org-api-settings, parse-csv-leads, parse-icp, parse-notes, parse-session-notes, run-deep-find, run-lookup-jobs, run-selected-autopilot, scrape-companies-house, scrape-cro, scrape-google-places, send-email and suggest-sequence. Some import shared configuration/rules indirectly; Claude should review the exact bundle union. Frontend changes are the Contacts domain warning, review/composer verification badges, row override confirmation, separate bulk-result counts and Deep find allowance text. No worker/VPS rollout is needed.

The SQL above proposes one table, one service-only outcome/suppression transaction and one authenticated org-scoped aggregate read. It remains solely in this report: **no migration was applied, no production SQL ran, and no migration file was created**. The metadata audit below is also review text only. The table/RPC must be approved, locally audited and applied before dependent functions/frontend are rolled out; missing outcome storage deliberately fails closed. Backfill is an explicit owner-authenticated action to run only after that rollout, not something this build invoked.

Independent Claude review, SQL compilation/transaction tests, RLS and cross-pipeline aggregate privacy, real DSN samples/MIME variants, real mailbox cursors/recovery, real SMTP/worker latency and browser/mobile/theme/dialog checks remain unverified. In particular, DSNs can be forged; sent-log/thread/ownership matching is a conservative correlation guard, not authentication of a remote mail server. Outcomes use one source-lead FK per org/address/outcome; deleting that associated lead conservatively forgets the evidence even if another lead also uses the address. Future third-party sends outside sendLeadEmail are not covered; no such production send path was found in this repository. The existing mailbox-settings test email is not a lead send and remains outside this recipient guard. Warm-isolate send pacing is not a durable global gate; the worker limiter remains authoritative across isolates. Longer retries do not override lead/function budgets or the people reserve.

No push, merge, deploy, Supabase write, secret use, paid fallback, worker/VPS edit, live mailbox action or real email/message occurred. The possible fixture.invalid DNS-only request from an initially unstubbed legacy test is disclosed under B3; final tests stub that path. Roles remain Codex builder and Claude architect/reviewer. Subscription usage is unavailable; no percentage is asserted. Project checkpoint documents are updated and the vault branch handoff will reference the final revision without overwriting accepted-main snapshots. No background jobs remain. Stop here for Claude's review; there is no unfinished builder item or authorisation for production actions.

### Proposed metadata audit — NOT executed, no fixture writes

This is an intentional rollback sentinel for a disposable local database after applying the reviewed draft there. It checks metadata/grants only; it does not replace business-effect, concurrency, org-isolation or deletion fixtures. Do not use it as permission to apply anything to production.

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'email_outcomes' AND c.relrowsecurity
  ) THEN RAISE EXCEPTION 'Email outcome RLS missing'; END IF;
  IF has_table_privilege('anon','public.email_outcomes','SELECT')
    OR has_table_privilege('authenticated','public.email_outcomes','INSERT')
    OR has_table_privilege('authenticated','public.email_outcomes','UPDATE')
    OR has_table_privilege('authenticated','public.email_outcomes','DELETE')
  THEN RAISE EXCEPTION 'Untrusted email outcome privileges'; END IF;
  IF NOT has_table_privilege('authenticated','public.email_outcomes','SELECT')
    OR NOT has_table_privilege('service_role','public.email_outcomes','INSERT')
  THEN RAISE EXCEPTION 'Required email outcome grants missing'; END IF;
  IF has_function_privilege('authenticated',
    'public.record_email_outcome(uuid,uuid,text,text,text,timestamptz,boolean)','EXECUTE')
    OR has_function_privilege('anon','public.email_domain_bounce_warnings(uuid,text[])','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.email_domain_bounce_warnings(uuid,text[])','EXECUTE')
  THEN RAISE EXCEPTION 'Email outcome RPC grants incorrect'; END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.email_outcomes'::regclass
      AND contype = 'f' AND confdeltype = 'c') <> 2
  THEN RAISE EXCEPTION 'Lead/org deletion cascades missing'; END IF;
  RAISE EXCEPTION 'Email outcome metadata audit passed; rollback requested';
END;
$$;
```
