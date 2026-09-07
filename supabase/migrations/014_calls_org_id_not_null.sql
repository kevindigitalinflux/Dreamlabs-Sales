-- calls.org_id must always be resolvable — a NULL org_id makes the row
-- invisible under RLS to every user (is_org_admin/is_org_member both
-- require a non-null match), including the service-role inserts that
-- would bypass RLS to create it. Table is empty (feature not yet wired
-- to a live dialer provider), so this is free to add now.
ALTER TABLE calls ALTER COLUMN org_id SET NOT NULL;

-- calls' only query path today (CallHistorySection) filters by lead_id
-- with no supporting index — same gap as email_logs, closing it here
-- since we're already touching this table.
CREATE INDEX idx_calls_lead ON calls(lead_id);
