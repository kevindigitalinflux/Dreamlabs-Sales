-- Appends an unsubscribe line to every already-seeded outreach template's
-- body (cold_outreach_1/2/3 x 2 orgs, jv_pitch_1/2 x 1 org — see
-- 006_outreach_automation.sql for the original seed). Uses the new
-- {{unsubscribe_url}} template variable (see _shared/templateVars.ts).
UPDATE email_templates
SET body = body || E'\n\nIf you''d rather not hear from us again, click here to unsubscribe: {{unsubscribe_url}}'
WHERE template_type IN ('cold_outreach_1', 'cold_outreach_2', 'cold_outreach_3', 'jv_pitch_1', 'jv_pitch_2');
