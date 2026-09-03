-- ─────────────────────────────────────────
-- Final whole-branch review (outreach automation cycle), B1: relax the
-- "own row in org" RLS policies on 5 tables to also allow the NULL-owner
-- case established this cycle (system-generated rows use
-- created_by/enrolled_by/sent_by: NULL to mean "belongs to the whole org,
-- not one specific human"). Without this, auth.uid() = NULL never matches
-- in SQL, so a non-admin org member (e.g. a contractor) cannot see any
-- autopilot-produced row — the scrape job, its raw leads, the approved
-- lead, the enrollment, or the drafted email — only org admins could.
--
-- Same fix shape as Task 11's write-side fix for send-email (system-
-- generated drafts couldn't be *claimed*); this is the read-side
-- counterpart. Org-membership gating and command scope (FOR ALL/etc.) are
-- unchanged on every policy below — only the owner-match clause is
-- relaxed to also accept NULL.
-- ─────────────────────────────────────────

-- leads: relax the created_by half only (assigned_to is a real per-human
-- assignment, not part of the null-owner convention, so it is untouched).
DROP POLICY "leads_own_in_org" ON leads;
CREATE POLICY "leads_own_in_org" ON leads FOR ALL USING (
  is_org_member(org_id) AND (created_by IS NULL OR auth.uid() = created_by OR auth.uid() = assigned_to)
);

-- sequence_enrollments
DROP POLICY "enrollments_own_in_org" ON sequence_enrollments;
CREATE POLICY "enrollments_own_in_org" ON sequence_enrollments FOR ALL USING (
  EXISTS (SELECT 1 FROM leads WHERE id = sequence_enrollments.lead_id AND is_org_member(leads.org_id))
  AND (enrolled_by IS NULL OR auth.uid() = enrolled_by)
);

-- email_logs
DROP POLICY "logs_own_in_org" ON email_logs;
CREATE POLICY "logs_own_in_org" ON email_logs FOR ALL USING (
  is_org_member(org_id) AND (sent_by IS NULL OR auth.uid() = sent_by)
);

-- scrape_jobs
DROP POLICY "scrape_jobs_own_in_org" ON scrape_jobs;
CREATE POLICY "scrape_jobs_own_in_org" ON scrape_jobs FOR ALL USING (
  is_org_member(org_id) AND (created_by IS NULL OR auth.uid() = created_by)
);

-- raw_leads (owner check is nested through a scrape_jobs.created_by join)
DROP POLICY "raw_leads_own_in_org" ON raw_leads;
CREATE POLICY "raw_leads_own_in_org" ON raw_leads FOR ALL USING (
  EXISTS (
    SELECT 1 FROM scrape_jobs
    WHERE id = raw_leads.scrape_job_id AND is_org_member(scrape_jobs.org_id)
    AND (scrape_jobs.created_by IS NULL OR scrape_jobs.created_by = auth.uid())
  )
);
