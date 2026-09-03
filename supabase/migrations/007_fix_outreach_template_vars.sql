-- supabase/migrations/007_fix_outreach_template_vars.sql
-- The cold_outreach_* templates seeded by 006_outreach_automation.sql used
-- {{company}}, which is not a real template variable — buildTemplateVars()
-- (src/lib/templateVars.ts and its Deno copy supabase/functions/_shared/templateVars.ts)
-- only ever produces {{business_name}}. This left {{company}} un-substituted,
-- so the plain-template fallback path (used whenever a Claude draft call fails)
-- produced broken copy like "quick one for " with a blank business name.
-- Found in Task 9's post-deploy deep review (2026-09-03).

UPDATE email_templates
SET subject = replace(subject, '{{company}}', '{{business_name}}'),
    body = replace(body, '{{company}}', '{{business_name}}')
WHERE template_type IN ('cold_outreach_1', 'cold_outreach_2', 'cold_outreach_3');
