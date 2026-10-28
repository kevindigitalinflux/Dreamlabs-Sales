-- REVIEW ONLY: never executed by the builder. Definitions traced to 006, 048 and 049.
BEGIN;
ALTER TABLE public.autopilot_runs DROP CONSTRAINT autopilot_runs_status_check;
ALTER TABLE public.autopilot_runs ADD CONSTRAINT autopilot_runs_status_check
  CHECK (status IN ('active','paused','completed','cancelled'));
ALTER TABLE public.autopilot_runs ADD COLUMN paused_at timestamptz, ADD COLUMN resumed_at timestamptz;
ALTER TABLE public.autopilot_run_leads ADD COLUMN queued_at timestamptz NOT NULL DEFAULT now();
UPDATE public.autopilot_run_leads SET queued_at = updated_at;
DROP INDEX public.autopilot_runs_one_active_per_org_mode;
CREATE UNIQUE INDEX autopilot_runs_one_active_per_org_mode ON public.autopilot_runs(org_id, mode)
  WHERE status IN ('active','paused');

CREATE OR REPLACE FUNCTION public.autopilot_runs_guard_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Preserve the existing engine privilege boundary.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT public.is_org_member(OLD.org_id) OR
     (OLD.created_by <> auth.uid() AND NOT public.is_org_admin(OLD.org_id)) THEN
    RAISE EXCEPTION 'Only the run creator or an organisation admin can control this run';
  END IF;
  IF NEW.status = OLD.status THEN
    IF NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason THEN
      RAISE EXCEPTION 'The stop reason cannot be changed';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.mode <> 'selected' THEN
    IF OLD.status = 'active' AND NEW.status = 'cancelled' THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'This control is only available for selected leads';
  END IF;
  IF OLD.status = 'active' AND NEW.status = 'paused' THEN
    NEW.paused_at := now(); NEW.cancel_reason := NULL; RETURN NEW;
  ELSIF OLD.status IN ('active','paused') AND NEW.status = 'cancelled' THEN
    NEW.cancel_reason := 'stopped by user'; RETURN NEW;
  ELSIF NEW.status = 'active' AND (OLD.status = 'paused' OR
      (OLD.status = 'cancelled' AND OLD.cancel_reason = 'stopped by user' AND current_user <> 'authenticated'
       AND EXISTS (SELECT FROM public.autopilot_run_leads WHERE run_id = OLD.id AND status = 'queued'))) THEN
    NEW.resumed_at := now(); NEW.cancel_reason := NULL; RETURN NEW;
  END IF;
  RAISE EXCEPTION 'This run cannot make that status change';
END $$;

-- The RPC owns sensitive stopped-run resume. Existing column UPDATE grants stay unchanged.
CREATE OR REPLACE FUNCTION public.autopilot_control_run(target_run uuid, action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.autopilot_runs;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to control this run'; END IF;
  SELECT * INTO r FROM public.autopilot_runs WHERE id = target_run FOR UPDATE;
  IF NOT FOUND OR r.mode <> 'selected' OR NOT EXISTS (
    SELECT FROM public.org_members WHERE org_id = r.org_id AND user_id = auth.uid()
      AND (r.created_by = auth.uid() OR role = 'admin')) THEN
    RAISE EXCEPTION 'Only the run creator or an organisation admin can control this run';
  END IF;
  IF action = 'pause' AND r.status = 'active' THEN
    UPDATE public.autopilot_runs SET status = 'paused' WHERE id = r.id;
  ELSIF action = 'stop' AND r.status IN ('active','paused') THEN
    UPDATE public.autopilot_runs SET status = 'cancelled', cancel_reason = 'stopped by user' WHERE id = r.id;
  ELSIF action = 'resume' AND (r.status = 'paused' OR (r.status = 'cancelled' AND r.cancel_reason = 'stopped by user'
    AND EXISTS (SELECT FROM public.autopilot_run_leads WHERE run_id = r.id AND status = 'queued'))) THEN
    UPDATE public.autopilot_runs SET status = 'active' WHERE id = r.id;
  ELSE RAISE EXCEPTION 'This run cannot make that status change';
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Another live run already exists. Stop it before resuming this run';
END $$;
REVOKE ALL ON FUNCTION public.autopilot_control_run(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.autopilot_control_run(uuid,text) TO authenticated;

-- Same run-row lock as pause and the existing autopilot_reserve_send UPDATE (049).
-- At most ONE worker per run. Never hold a transaction open during external work.
CREATE OR REPLACE FUNCTION public.autopilot_claim_lead(target_run uuid)
RETURNS TABLE(id uuid, run_id uuid, lead_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.autopilot_runs; row_id uuid;
BEGIN
  SELECT * INTO r FROM public.autopilot_runs WHERE autopilot_runs.id = target_run FOR UPDATE;
  IF NOT FOUND OR r.status <> 'active' OR r.mode <> 'selected' THEN RETURN; END IF;
  IF EXISTS (SELECT FROM public.autopilot_run_leads q WHERE q.run_id = target_run AND q.status = 'working') THEN RETURN; END IF;
  SELECT q.id INTO row_id FROM public.autopilot_run_leads q WHERE q.run_id = target_run AND q.status = 'queued'
    ORDER BY q.queued_at, q.id LIMIT 1 FOR UPDATE;
  RETURN QUERY UPDATE public.autopilot_run_leads q SET status = 'working', claimed_at = now(), updated_at = now()
    WHERE q.id = row_id AND q.status = 'queued' RETURNING q.id,q.run_id,q.lead_id;
END $$;
REVOKE ALL ON FUNCTION public.autopilot_claim_lead(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.autopilot_claim_lead(uuid) TO service_role;

-- Completion cannot consume a queue after a concurrent pause or while a worker owns a lead.
CREATE OR REPLACE FUNCTION public.autopilot_finish_selected(target_run uuid, finish_reason text, cancel_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.autopilot_runs;
BEGIN
  SELECT * INTO r FROM public.autopilot_runs WHERE id = target_run FOR UPDATE;
  IF NOT FOUND OR r.status <> 'active' OR r.mode <> 'selected' THEN RETURN; END IF;
  IF EXISTS (SELECT FROM public.autopilot_run_leads WHERE run_id = r.id AND status = 'working') THEN RETURN; END IF;
  IF finish_reason IS NOT NULL THEN
    UPDATE public.autopilot_run_leads SET status = 'not_reached',reason = finish_reason,updated_at = now()
      WHERE run_id = r.id AND status = 'queued';
  END IF;
  UPDATE public.autopilot_runs SET status = 'completed',cancel_reason = cancel_note WHERE id = r.id;
END $$;
REVOKE ALL ON FUNCTION public.autopilot_finish_selected(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.autopilot_finish_selected(uuid,text,text) TO service_role;
COMMIT;
