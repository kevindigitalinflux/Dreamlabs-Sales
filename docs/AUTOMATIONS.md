# Automations Register

Living list of every automation in Dreamlabs Sales — edge functions, scheduled jobs,
AI calls, and DB triggers. **Update this file whenever an automation is added, changed,
or retired.** (Requested by Kevin, 2026-07-17.)

## Conventions

- **Trigger** — what causes it to run (user action, cron, DB event).
- **Sends anything?** — automations never send email or mutate leads without a human
  click unless explicitly stated.

## Live

| Automation | Type | Trigger | What it does |
|---|---|---|---|
| Worker usage limits (`usage_reserve` / `usage_refund`) | Postgres functions | Every call to the lookup worker (once sub-project C wires it in), via `reserveUsage` in `_shared/usage.ts` | Atomically counts site scrapes, email checks and page fetches per organisation and worker-wide per London day (defaults 100/400, 150/300, 300/1000); refuses when either cap is reached; fails closed. Owner: Kevin. Limits: Settings (organisation admins); shared caps in `usage_resources` via migration. Tables `usage_counters`, `usage_global_counters`, `usage_limits`. |
| `admin-users` | Edge function | Admin UI action | Invites users (Supabase invite email), sets roles, service-role only |
| `handle_new_user` | DB trigger | auth.users insert | Auto-creates `profiles` row (role contractor) on signup/invite |
| Stage-change logging | App logic (`applyLeadUpdate`) | Lead stage edit | Auto-inserts "Stage changed: X → Y" note to `lead_notes` |
| Call-stats bump | App logic (`useLeadNotes.addNote`) | Call note saved | Increments `call_count`, sets `last_contacted_at` |
| Realtime pipeline sync | Supabase Realtime | `leads` table change | Live-updates Kanban/list/dashboard without refresh |
| `email-settings` | Edge function | User saves SMTP config | Writes credentials to Supabase Vault via `app_set_smtp_secret` (service-role-only SQL fn); test-email action sets `is_verified`. **Live since cycle 2 (2026-07-19)** |
| `generate-email` | Edge function + AI | Composer / check-sequences | Personalises a template via Gemini (`AI_MODEL` in `_shared/ai.ts`, currently `gemini-3.6-flash` — 2.5-flash was retired by Google mid-cycle-3; swappable `draftEmail()`). **Cycle 3:** resolves the calling lead's own org's API key via `resolveOrgApiKey()` (`_shared/orgApiKeys.ts`) — the org's own Vault-stored key (`org_api_settings`) if configured, else the global `GEMINI_API_KEY` secret **only if** that org has `use_global_api_fallback=true` (Kevin's two orgs only). Falls back to plain substitution (`ai_used:false`) on no key or any AI failure. Caller-JWT data access (RLS enforced, org-scoped). |
| `send-email` | Edge function | **User clicks Send** | SMTP send from the user's own verified address (Vault creds via `app_get_smtp_secret`); CR/LF header-injection guard in `_shared/smtp.ts`; logs `sent`/`failed`+error to `email_logs`, surfaces a `warning` if the audit log write itself fails. **Waiting on Kevin's SMTP setup for the DI Dreamlabs org (human step)** |
| `check-sequences` | pg_cron daily 06:00 UTC → edge function | Schedule (job `check-sequences-daily`) | Drafts due sequence emails into the review queue (`status='draft'`), advances enrollment pointers; skips (and retries next run) on missing email/template or insert failure; 7s spacing for Gemini RPM. Gated by `x-cron-secret` (Vault). `verify_jwt=false` pinned in `supabase/config.toml`. **Cycle 3:** resolves each due lead's own org's API key the same way as `generate-email` (`resolveOrgApiKey()`) rather than always using the global secret — a lead in a non-Kevin org with no key configured still gets its plain-template draft queued, just without AI personalisation. Drafts only — never sends. Live, e2e-proven |
| `parse-notes` | Edge function + AI | Note saved with AI toggle on | Suggests lead field updates from the note; client whitelist-validates (`sanitizeSuggestion`) then shows a review diff; only the user's Apply click writes, via the stage-auto-logging path. **Cycle 3:** resolves the note's lead's own org's API key via `resolveOrgApiKey()`, same global-fallback-for-Kevin's-orgs-only rule as `generate-email`; returns `suggestion:null` when no key is available for that org. |

## Local branch, not applied or deployed

| Automation | Type | Trigger | What it changes / owner |
|---|---|---|---|
| `run-lookup-jobs` | Supabase edge function + pg_cron | Pipeline buttons POST create; authenticated creator/admin POST cancel; `run-lookup-jobs-tick` every minute (`* * * * *`), `x-cron-secret` header read from the existing Vault `cron_secret` at execution time (same mechanism as Deep find) | Creates `lookup_jobs` and `lookup_job_leads`; claims one row per tick iteration, with one active row per org, a 5-minute lease and at most two attempts. Proposes enrichment using `enrichOneLead`, free reader then worker fallback before paid sources; stores decision-maker candidates through the existing helper (migration 053 defaults sequence participation off). Updates progress/results, skips cancelled/unauthorised/limited work, completes jobs. Enrichment writes to leads only after the user's Apply click; `lookup_job_review` requires org membership and lead edit rights and changes only pending review to applied/dismissed. Results require org membership and lead visibility; deleted leads cascade their result rows while job counts stay snapshots. No emails or sequence enrolment. Owner: Kevin (product), Claude (review), Codex (build), code `_shared/lookupJobs.ts` / `run-lookup-jobs/index.ts`. **Migration 061 completed under Claude's rulings; independent review and application/deployment pending. Nothing in this row is live.** |

## Backlog (future cycles)

| Automation | Cycle | Notes |
|---|---|---|
| `scrape-google-places` | 3 | Google Places lead scraping (API key needed) |
| `scrape-companies-house` | 3 | Companies House scraping (free API key) |
| `parse-icp` | 3 | Gemini ICP form → scraper query parsing |
| Contact-email discovery | 3 | Fetch business website, parse mailto/contact page (part of scraper) |
| Overdue follow-up nudge | idea | Daily digest of overdue next-actions (email or in-app) — not yet designed |
| CSV/Sheets lead import | idea | Bulk import from the old Google Sheets workflow — not yet designed |
| Jobs tracker (view + delete) | B | In-app only: `/jobs`, bar, tab title. Reads deep_find_runs, autopilot_runs, scrape_jobs; deletes only finished jobs the user created or admins (migration 060). No emails, no cron. Owner: `src/lib/jobs/`. |
