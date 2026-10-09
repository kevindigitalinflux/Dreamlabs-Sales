-- 051: record which email template a draft/sent email came from.
-- Additive and nullable. No RLS change: email_logs policies are row-level FOR ALL (001/003/009)
-- and there are no column-scoped grants, so the new column is covered like every other column.
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_email_logs_template ON email_logs(template_id) WHERE template_id IS NOT NULL;
