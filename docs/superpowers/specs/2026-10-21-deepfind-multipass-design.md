# Deep find multi-pass runs (up to 5 minutes per lead) — Design

Date: 2026-10-21. Author: Claude (architect). Trigger (Kevin, UKRM test): "if the search needs longer then we should increase the time limit as long as it actually does it properly ... the email verifier, scraping and crawling as powerful as can be ... not more than 10 minutes". Kevin then agreed on **5 minutes** as the hard maximum per lead (10 is too much).

## Constraint
Supabase is on the FREE plan: one edge function call is cut off at about 150 s (current `WALL_BUDGET_MS` 130 s, per-lead `LEAD_BUDGET_MS` 70 s). A longer run must therefore be several short PASSES, not one long call. The worker allows 5 email checks per domain per minute, so passes about a minute apart match that limit.

## Rules (binding, unchanged)
Review-before-send; auto-apply blank-only with Undo; only checker `valid` fills an email; credits (Hunter/AI/Firecrawl) never double-charged across passes; worker only via `workerClient`; secrets never logged; plain English; no migration unless unavoidable (then STOP and record the question: a `pass`/`next_pass_at` column on `deep_find_leads` would be additive and is preferred over jsonb if needed; jsonb in `domains` is acceptable first).

## Design
1. After a pass, if work remains (unchecked candidate formats, people lookups not done, time ran out) AND total elapsed for the lead < 300 s AND pass < 5, the lead is re-queued (`status='queued'`, `claimed_at=null`, `domains.pass = n+1`, `domains.next_pass_at` ≥ 60 s later) instead of `done`. The run stays active; the UI shows "Still working, pass n".
2. State carried in `domains`: `check_cache` ({email: {status, reason}}), `credits` already spent, `steps` (append, dedupe), `started_at`, `pass`. Pass n+1 reuses `check_cache` (no re-checking, no re-reserving worker units), skips Hunter/AI/Firecrawl steps already done, continues the guess queue where it stopped.
3. Raise the verify allowance per lead (6 → 12) and per domain per run (5 → 10, i.e. 5 per pass); stop rules unchanged (first `unverifiable` stops a domain; `invalid` excludes; only `valid` accepts).
4. Hard stop at 300 s total or 5 passes or when nothing remains; the final result says "Checked in N passes, M minutes" and why it stopped. Cancel (Stop) works between passes.
5. Claim logic (`deep_find_claim`) must skip rows whose `next_pass_at` is in the future; the cron tick (every minute) picks them up. Per-lead daily rate limit (5/day) counts a multi-pass run ONCE (check `rateLimit` key only on pass 1).
6. Tests: pass accounting, cache reuse (no repeat worker calls), credits not double-charged, 5-minute/5-pass cap, cancel between passes, claim skipping future rows, final summary line.

## Delivery
Branch `codex/deepfind-multipass`; gates tsc/vitest/build; HANDOFF section; independent review; deploy `run-deep-find` only after Kevin approves.
