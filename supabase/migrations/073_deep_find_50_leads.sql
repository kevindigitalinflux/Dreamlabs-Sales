-- 073: allow 50 leads per Deep find run (code already allowed 50; this CHECK still said 25).
ALTER TABLE public.deep_find_runs DROP CONSTRAINT deep_find_runs_lead_count_check;
ALTER TABLE public.deep_find_runs ADD CONSTRAINT deep_find_runs_lead_count_check CHECK (lead_count >= 1 AND lead_count <= 50);
