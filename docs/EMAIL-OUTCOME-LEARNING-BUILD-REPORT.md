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
    SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.org_id = email_outcomes.org_id
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
