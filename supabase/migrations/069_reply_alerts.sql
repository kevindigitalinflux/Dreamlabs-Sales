-- REVIEW ONLY. No builder execution. Existing stage values come from 001_initial_schema.sql.
BEGIN;
ALTER TABLE public.leads DROP CONSTRAINT leads_stage_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_stage_check CHECK (stage IN (
  'new_lead','contacted','replied','audit_booked','proposal_sent','negotiating','won','lost','not_now_nurture'
));
ALTER TABLE public.user_email_settings
  ADD COLUMN reply_alerts_after timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_imap_ok_at timestamptz,
  ADD COLUMN last_imap_error text CHECK (last_imap_error IN ('wrong_password','imap_disabled','cannot_connect','check_failed')),
  ADD COLUMN last_imap_error_at timestamptz;
ALTER TABLE public.email_replies
  ADD COLUMN message_id text,
  ADD COLUMN preview text NOT NULL DEFAULT '',
  ADD COLUMN opt_out_suspected boolean NOT NULL DEFAULT false,
  ADD COLUMN attachment_count integer NOT NULL DEFAULT 0 CHECK (attachment_count >= 0),
  ADD COLUMN thread_references text NOT NULL DEFAULT '',
  ADD COLUMN handled_at timestamptz,
  ADD COLUMN ai_draft_log_id uuid REFERENCES public.email_logs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX email_replies_message_id_unique ON public.email_replies(message_id);
ALTER TABLE public.email_logs ADD COLUMN reply_id uuid REFERENCES public.email_replies(id) ON DELETE SET NULL;
-- Existing rows are not backfilled into alerts. The admin FOR ALL policy otherwise bypasses a permissive SELECT policy.
ALTER POLICY email_replies_org_read ON public.email_replies USING (public.is_org_member(org_id) AND public.can_view_lead(lead_id));
CREATE POLICY email_replies_visible_only ON public.email_replies AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_view_lead(lead_id));

CREATE TABLE public.reply_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reply_id uuid NOT NULL REFERENCES public.email_replies(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reply_id,user_id)
);
ALTER TABLE public.reply_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reply_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reply_notifications TO authenticated;
GRANT UPDATE(read_at) ON public.reply_notifications TO authenticated;
GRANT ALL ON public.reply_notifications TO service_role;
CREATE POLICY reply_notifications_own_read ON public.reply_notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(org_id) AND EXISTS (
    SELECT 1 FROM public.email_replies r WHERE r.id = reply_id AND r.org_id = reply_notifications.org_id));
CREATE POLICY reply_notifications_own_update ON public.reply_notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(org_id) AND EXISTS (
    SELECT 1 FROM public.email_replies r WHERE r.id = reply_id AND r.org_id = reply_notifications.org_id))
  WITH CHECK (user_id = auth.uid());
CREATE INDEX reply_notifications_unread ON public.reply_notifications(user_id,created_at) WHERE read_at IS NULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.reply_notifications;

-- Explicit-user equivalent of 018 can_view_lead/can_view_pipeline. Membership is always required.
CREATE FUNCTION public.reply_alert_recipients(target_reply uuid)
RETURNS TABLE(user_id uuid, role text, can_view boolean) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '' AS $$
  SELECT DISTINCT m.user_id, m.role::text, true
  FROM public.email_replies r JOIN public.email_logs log ON log.id = r.email_log_id AND log.org_id = r.org_id
  JOIN public.leads l ON l.id = r.lead_id AND l.org_id = r.org_id
  JOIN public.pipelines p ON p.id = l.pipeline_id AND p.org_id = r.org_id
  JOIN public.org_members m ON m.org_id = r.org_id
  WHERE r.id = target_reply AND (m.user_id = log.sent_by OR m.role = 'admin') AND (
    m.role = 'admin'
    OR (p.is_default AND (l.created_by IS NULL OR l.created_by = m.user_id OR l.assigned_to = m.user_id))
    OR (NOT p.is_default AND (p.created_by = m.user_id OR EXISTS (
      SELECT 1 FROM public.pipeline_shares s WHERE s.pipeline_id = p.id AND s.shared_with_user_id = m.user_id)))
  );
$$;
REVOKE ALL ON FUNCTION public.reply_alert_recipients(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reply_alert_recipients(uuid) TO service_role;

-- Non-admin viewers may mark a reply handled without receiving general reply UPDATE privileges.
CREATE FUNCTION public.reply_mark_handled(target_reply uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RETURN false; END IF;
  UPDATE public.email_replies SET handled_at = COALESCE(handled_at,now())
    WHERE id = target_reply AND public.is_org_member(org_id) AND public.can_view_lead(lead_id);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;
REVOKE ALL ON FUNCTION public.reply_mark_handled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reply_mark_handled(uuid) TO authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'check-replies-daily';
SELECT cron.schedule('check-replies-tick', '*/5 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/check-replies',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')),
    body := '{}'::jsonb
  );
$cron$);
COMMIT;
-- Rollback requires a reviewed plan: remove cron/publication/table/functions/policies/new columns first;
-- preserve any real reply data, and map replied leads deliberately before restoring the earlier stage constraint.
