-- ─────────────────────────────────────────
-- CYCLE 2: email automation — seeds, vault helpers, cron
-- ─────────────────────────────────────────

-- 1. Default templates (visible to everyone via is_default RLS policy)
INSERT INTO email_templates (name, subject, body, template_type, is_default, created_by) VALUES
('Initial Follow-Up (48h)', 'Following up — {{business_name}}',
'Hi {{first_name}},

Thanks for taking my call — I know you''re busy running {{business_name}}, so I''ll keep this short.

We talked about {{pain_point}}. That''s exactly the kind of thing we fix at Dreamlabs, and I''d hate for it to keep costing you work.

Shall we get your free audit booked in? It takes 20 minutes and you''ll get value from it whether or not we work together.

{{cal_link}}

Speak soon,
{{contractor_name}}
Digital Influx Dreamlabs', 'initial_followup', true, NULL),

('Second Chase (7 days)', 'Quick check-in — {{business_name}}',
'Hi {{first_name}},

Just floating this back to the top of your inbox — no pressure at all.

If now isn''t the right time for {{business_name}}, tell me and I''ll stop nudging. If it is, my earlier email has everything you need to grab a slot.

Best,
{{contractor_name}}', 'second_chase', true, NULL),

('Not Now Nurture (30 days)', 'Checking back in — {{business_name}}',
'Hi {{first_name}},

You mentioned the timing wasn''t right, so I made a note to check back — this is that note.

No sales pitch: just letting you know we''re still here, still helping businesses like {{business_name}} win back hours every week. If anything''s changed, I''d love to hear how things are going either way.

All the best,
{{contractor_name}}', 'not_now_nurture', true, NULL),

('Audit Confirmation', 'Your Free Business Audit — confirmed for {{audit_date}}',
'Hi {{first_name}},

Great news — your free business audit is confirmed for {{audit_date}}.

What to expect: we''ll walk through how {{business_name}} handles enquiries, follow-ups and repeat work, and I''ll show you exactly where time and money are leaking. You''ll leave with an action list you can use with or without us.

Nothing to prepare. See you then!

{{contractor_name}}
Digital Influx Dreamlabs', 'audit_confirmation', true, NULL),

('Proposal Follow-Up', 'Your Dreamlabs proposal — {{business_name}}',
'Hi {{first_name}},

I wanted to check you''d had a chance to look over the proposal for {{business_name}} ({{package_name}}, {{deal_value}}).

Happy to walk through any part of it on a quick call — and if something doesn''t fit, we can adjust it. What questions can I answer?

Best,
{{contractor_name}}', 'proposal_followup', true, NULL);

-- 2. Default sequences (steps reference templates by template_type)
INSERT INTO email_sequences (name, description, steps, is_default, created_by) VALUES
('Proposal Follow-Up', 'Chase a sent proposal without being annoying.',
 '[{"delay_days":0,"template_type":"initial_followup","subject_override":null},
   {"delay_days":2,"template_type":"second_chase","subject_override":null},
   {"delay_days":7,"template_type":"proposal_followup","subject_override":null}]'::jsonb,
 true, NULL),
('Not Now Nurture', 'Stay warm with leads who said "not now".',
 '[{"delay_days":0,"template_type":"not_now_nurture","subject_override":null},
   {"delay_days":30,"template_type":"not_now_nurture","subject_override":null}]'::jsonb,
 true, NULL);

-- 3. Vault helpers for per-user SMTP secrets (service_role only)
CREATE OR REPLACE FUNCTION app_set_smtp_secret(uid uuid, secret text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'smtp_pass_' || uid::text;
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(secret, 'smtp_pass_' || uid::text);
  ELSE
    PERFORM vault.update_secret(existing_id, secret);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_get_smtp_secret(uid uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'smtp_pass_' || uid::text;
$$;

REVOKE ALL ON FUNCTION app_set_smtp_secret(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_get_smtp_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_set_smtp_secret(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION app_get_smtp_secret(uuid) TO service_role;

-- 4. Cron: daily sequence check at 06:00 UTC.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- One-off shared secret between cron and the edge function.
SELECT vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'cron_secret')
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret');

SELECT cron.schedule(
  'check-sequences-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/check-sequences',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
