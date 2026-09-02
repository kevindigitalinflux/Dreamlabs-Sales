-- ─────────────────────────────────────────
-- Enable realtime for the lead-scraper's live progress UI (useScrapeJob's
-- postgres_changes subscription needs both tables in the publication —
-- discovered missing in cycle 4's final whole-branch review).
-- ─────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE scrape_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE raw_leads;
