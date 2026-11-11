-- 074: email_logs recipient tier snapshot + per-message hard bounce stamp. Reviewed and applied by Claude 2026-11-11.
ALTER TABLE public.email_logs
  ADD COLUMN recipient_tier_at_send text,
  ADD COLUMN recipient_tier_basis text,
  ADD COLUMN recipient_tier_version smallint,
  ADD COLUMN recipient_was_sent_ok boolean,
  ADD COLUMN recipient_tier_recorded_at timestamptz,
  ADD COLUMN hard_bounced_at timestamptz,
  ADD CONSTRAINT email_logs_tier_snapshot_shape CHECK (
    (recipient_tier_at_send IS NULL AND recipient_tier_basis IS NULL
      AND recipient_tier_version IS NULL AND recipient_was_sent_ok IS NULL
      AND recipient_tier_recorded_at IS NULL)
    OR
    (recipient_tier_at_send IS NOT NULL AND recipient_tier_at_send IN ('T1','T2','T3')
      AND status IS NOT DISTINCT FROM 'sent' AND sent_at IS NOT NULL
      AND recipient_tier_basis IS NOT NULL AND recipient_tier_version = 1
      AND recipient_tier_version IS NOT NULL AND recipient_was_sent_ok IS NOT NULL
      AND recipient_tier_recorded_at IS NOT NULL AND recipient_tier_recorded_at >= sent_at
      AND (NOT recipient_was_sent_ok OR recipient_tier_at_send = 'T1')
      AND ((recipient_tier_at_send = 'T1' AND recipient_tier_basis IN
        ('checker_valid','replied','sent_ok','company_site','places','saved_non_guessed'))
        OR (recipient_tier_at_send = 'T2' AND recipient_tier_basis = 'supported_pattern')
        OR (recipient_tier_at_send = 'T3' AND recipient_tier_basis IN
          ('evidence_mismatch','role_review','pattern_paused','weak_evidence')))
      AND (recipient_tier_basis <> 'sent_ok' OR recipient_was_sent_ok))
  ),
  ADD CONSTRAINT email_logs_bounce_stamp_shape CHECK (
    hard_bounced_at IS NULL OR
    (status IS NOT DISTINCT FROM 'sent' AND sent_at IS NOT NULL AND hard_bounced_at >= sent_at)
  );

CREATE FUNCTION public.guard_email_log_recipient_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.recipient_tier_at_send IS NOT NULL OR NEW.recipient_tier_basis IS NOT NULL
        OR NEW.recipient_tier_version IS NOT NULL OR NEW.recipient_was_sent_ok IS NOT NULL
        OR NEW.recipient_tier_recorded_at IS NOT NULL OR NEW.hard_bounced_at IS NOT NULL
      THEN RAISE EXCEPTION 'Recipient evidence is service-written' USING ERRCODE = '42501'; END IF;
    ELSE
      IF ROW(NEW.recipient_tier_at_send, NEW.recipient_tier_basis, NEW.recipient_tier_version,
          NEW.recipient_was_sent_ok, NEW.recipient_tier_recorded_at, NEW.hard_bounced_at)
        IS DISTINCT FROM ROW(OLD.recipient_tier_at_send, OLD.recipient_tier_basis,
          OLD.recipient_tier_version, OLD.recipient_was_sent_ok,
          OLD.recipient_tier_recorded_at, OLD.hard_bounced_at)
      THEN RAISE EXCEPTION 'Recipient evidence is service-written' USING ERRCODE = '42501'; END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS NOT DISTINCT FROM 'sent' AND OLD.recipient_tier_at_send IS NULL
      AND NEW.recipient_tier_at_send IS NOT NULL
    THEN RAISE EXCEPTION 'Historical send tiers cannot be invented'; END IF;
    IF OLD.recipient_tier_at_send IS NOT NULL AND
      ROW(NEW.recipient_tier_at_send, NEW.recipient_tier_basis, NEW.recipient_tier_version,
          NEW.recipient_was_sent_ok, NEW.recipient_tier_recorded_at)
      IS DISTINCT FROM ROW(OLD.recipient_tier_at_send, OLD.recipient_tier_basis,
          OLD.recipient_tier_version, OLD.recipient_was_sent_ok, OLD.recipient_tier_recorded_at)
    THEN RAISE EXCEPTION 'Sent recipient tier is immutable'; END IF;
    IF OLD.hard_bounced_at IS NOT NULL AND NEW.hard_bounced_at IS DISTINCT FROM OLD.hard_bounced_at
    THEN RAISE EXCEPTION 'Recorded message bounce is immutable'; END IF;
    IF (OLD.recipient_tier_at_send IS NOT NULL OR OLD.hard_bounced_at IS NOT NULL) AND
      ROW(NEW.org_id, NEW.sent_by, NEW.to_email, NEW.sent_at, NEW.message_id, NEW.status)
      IS DISTINCT FROM ROW(OLD.org_id, OLD.sent_by, OLD.to_email, OLD.sent_at, OLD.message_id, OLD.status)
    THEN RAISE EXCEPTION 'Recipient evidence cannot move to another send'; END IF;
  END IF;
  IF NEW.hard_bounced_at > clock_timestamp() + interval '5 minutes'
    OR NEW.recipient_tier_recorded_at > clock_timestamp() + interval '5 minutes'
  THEN RAISE EXCEPTION 'Future recipient evidence is invalid'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_email_log_recipient_evidence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_email_log_recipient_evidence() TO service_role;
CREATE TRIGGER email_logs_recipient_evidence_guard
  BEFORE INSERT OR UPDATE ON public.email_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_email_log_recipient_evidence();
CREATE INDEX email_logs_mailbox_reputation_window
  ON public.email_logs(org_id, sent_by, sent_at DESC) WHERE status = 'sent';
