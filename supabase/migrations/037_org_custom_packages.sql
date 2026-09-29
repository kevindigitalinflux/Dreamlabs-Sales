-- Per-org customizable package list ("Company profile customization").
--
-- Until now every org's leads offered the same hardcoded DI Dreamlabs package
-- tiers (leads.package_tier was a CHECK-constrained enum), wrong for e.g. Mr
-- Brush & Co, a cleaning company. Each org can now store its own list of
-- package names; NULL means "use the built-in default list" so every existing
-- org (incl. DI Dreamlabs) behaves exactly as before until an admin customizes.
--
-- A custom package's stored value on a lead IS its label (free text), so
-- leads.package_tier can no longer be restricted to the old fixed enum.
--
-- organizations' column-scoped UPDATE grant (migration 025) only covers
-- company_context; extend it to this one new column, nothing wider. The
-- existing organizations_admin_update_context policy (is_org_admin(id)) already
-- gates WHICH rows an admin can update.

ALTER TABLE organizations ADD COLUMN custom_packages TEXT[];

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_package_tier_check;

GRANT UPDATE (custom_packages) ON organizations TO authenticated;
