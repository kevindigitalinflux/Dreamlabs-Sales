-- Lets a scrape job (real scrape or CSV import) carry a resolved target pipeline
-- as the review page's default, set once up front rather than re-picked per row.
-- Nullable and RLS-free by design: the real access gate is leads_insert's
-- can_insert_lead_into(pipeline_id) check at actual approval time (migration 018),
-- already reviewed -- this column is a convenience default, not a second gate.
ALTER TABLE scrape_jobs ADD COLUMN pipeline_id UUID REFERENCES pipelines(id);
