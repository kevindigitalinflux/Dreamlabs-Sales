-- Adds a free-text "company context" field per org, injected into AI-drafted
-- email/LinkedIn copy so the AI knows what the org actually does (previously
-- hardcoded as "a UK agency selling automation/AI systems to small businesses"
-- for every org, including Mr Brush & Co -- a cleaning company).
--
-- organizations currently has NO update policy at all (only
-- organizations_member_read for SELECT) -- name/use_global_api_fallback are
-- effectively admin-console/SQL-only today. Adding update access here must not
-- accidentally widen that: the table already carries a blanket, unscoped
-- `GRANT UPDATE ON organizations TO authenticated` from migration 003, so a
-- naive new policy would let any org admin update EVERY column, not just this
-- one. Re-scope the grant to company_context only first, matching the same
-- REVOKE + column-scoped GRANT fix already applied to `profiles` in migration
-- 017 for the identical reason.

ALTER TABLE organizations ADD COLUMN company_context TEXT;

REVOKE UPDATE ON organizations FROM authenticated;
GRANT UPDATE (company_context) ON organizations TO authenticated;

CREATE POLICY "organizations_admin_update_context" ON organizations FOR UPDATE
  USING (is_org_admin(id));
