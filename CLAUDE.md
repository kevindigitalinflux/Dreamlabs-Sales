# Dreamlabs Sales

## What This Is
Dreamlabs Sales is a standalone internal sales operations web app for Digital Influx Dreamlabs Ltd and its commission-based sales contractors. It solves three problems in one tool: finding qualified SME prospects via a multi-source lead scraper (powered by public APIs and an AI ICP parser), managing those prospects through a full sales pipeline with both Kanban and list views, and automating tailored email follow-ups using session notes and AI-generated drafts. The app is built desktop-first with full ADHD and dyslexia-friendly design principles, and a mobile-optimised note-taking flow for contractors in the field. It will eventually serve as a white-label template for Dreamlabs client products.

Reference the companion spec for full feature, schema, and architecture detail:
→ `SPEC.md` (lives in project root alongside this file)

---

## Tech Stack

| Layer | Default |
|---|---|
| Framework | React 18 with TypeScript |
| Build Tool | Vite (latest) |
| Styling | Tailwind CSS v3 — utility classes only, no custom CSS unless absolutely necessary |
| Routing | React Router v6 |
| Database + Auth | Supabase |
| Hosting | Cloudflare Pages (auto-deploy from GitHub main) |
| Version Control | GitHub |
| Component Reference | 21st.dev |
| AI Dev Environment | Claude Code |

---

## Project Structure

```
src/
├── components/
│   ├── ui/                  # Base design system components (Button, Card, Badge, Modal, Input)
│   ├── layout/              # AppShell, Sidebar, TopBar, MobileNav
│   ├── scraper/             # ICPForm, JobCard, RawLeadRow, ApprovalPanel
│   ├── pipeline/            # KanbanBoard, KanbanColumn, LeadCard, LeadDetail, ListTable
│   ├── emails/              # TemplateEditor, SequenceBuilder, EmailLog, EmailComposer
│   ├── dashboard/           # TodaysFocus, StatsBar, ActivityFeed, OverdueAlerts
│   └── admin/               # UserTable, UserForm, AssignmentPanel
├── pages/
│   ├── Dashboard.tsx        # / — Today's Focus + quick stats
│   ├── Scraper.tsx          # /scraper — ICP form entry point
│   ├── ScraperJob.tsx       # /scraper/jobs/:id — results + approval
│   ├── ScraperJobs.tsx      # /scraper/jobs — job history
│   ├── Pipeline.tsx         # /pipeline — Kanban/List toggle view
│   ├── LeadDetail.tsx       # /pipeline/leads/:id — full lead record
│   ├── EmailTemplates.tsx   # /emails/templates
│   ├── EmailSequences.tsx   # /emails/sequences
│   ├── EmailLogs.tsx        # /emails/logs
│   ├── Analytics.tsx        # /analytics
│   ├── Settings.tsx         # /settings
│   ├── EmailConfig.tsx      # /settings/email
│   ├── Admin.tsx            # /admin (admin role only)
│   └── Login.tsx            # /login
├── lib/
│   ├── supabase.ts          # Supabase client initialisation
│   ├── gemini.ts            # Gemini API helpers (ICP parse, note parse, email draft)
│   ├── email.ts             # Email send via Edge Function
│   ├── scraper.ts           # Scraper job trigger + polling
│   └── utils.ts             # Date formatting, string helpers, colour maps
├── hooks/
│   ├── useAuth.ts           # Auth state + role
│   ├── useLeads.ts          # Pipeline CRUD + real-time subscription
│   ├── useScraper.ts        # Scrape job state machine
│   └── useEmailConfig.ts    # User SMTP settings
├── types/
│   └── index.ts             # All shared TypeScript interfaces
├── assets/
│   └── fonts/               # Montserrat + DM Sans (self-hosted)
└── main.tsx
public/
supabase/
├── functions/
│   ├── scrape-google-places/    # Edge Function: Google Places API scraper
│   ├── scrape-companies-house/  # Edge Function: Companies House API scraper
│   ├── parse-icp/               # Edge Function: Gemini ICP parsing
│   ├── parse-notes/             # Edge Function: Gemini note analysis + lead update
│   ├── generate-email/          # Edge Function: Gemini email drafting
│   └── send-email/              # Edge Function: Nodemailer SMTP send
└── migrations/
    └── 001_initial_schema.sql
CLAUDE.md
SPEC.md
.env
.gitignore
package.json
vite.config.ts
```

---

## Coding Conventions

- Use **TypeScript strict mode** throughout — no `any`, cast to `unknown` first if needed
- **Components in PascalCase** (e.g. `HeroSection.tsx`)
- **Utility functions in camelCase**
- **Named exports only** — no default exports
- Style exclusively with **Tailwind utility classes** — no custom CSS or inline styles
- Every component must handle **loading, error, and empty states**
- Keep components **under 150 lines** — extract sub-components if needed
- Add **JSDoc comments** to all exported functions
- File extensions: `.ts` for logic, `.tsx` for components

---

## AIXD Engineering Rules

### Prompting
- Always break large tasks into smaller focused steps before starting
- One task per prompt — complete and commit before moving to the next
- Give full context in every prompt: file path, component name, expected behaviour, screen size if relevant
- If a prompt was wrong, edit the original — do not send a follow-up correction

### Development Loop
1. Write a focused prompt for one specific task
2. Let Claude Code build it
3. Read the diff — understand every change before accepting
4. Test in the browser at localhost
5. Commit if it works, revert if it does not
6. Move to the next task

### Git Discipline
- Always start from a clean `git status` before new work
- Commit after every meaningful piece of work — small commits, easy rollbacks
- Never auto-accept changes without reviewing the diff
- Commit message format: `feat:`, `fix:`, `refactor:`, `chore:`

### Security (Non-Negotiable)
- Secrets live in `.env` only — never in code, never in a chat, never in a document
- `.env` is in `.gitignore` before the first commit
- If a secret has been committed, treat it as compromised and rotate immediately
- Reference env vars as `import.meta.env.VITE_YOUR_KEY_NAME` — never as hardcoded strings
- RLS is enabled on every Supabase table without exception
- All Supabase queries that return user data must filter by `auth.uid()`
- Never use sequential integer IDs in URLs for private resources — use UUIDs
- CORS whitelisted to your exact domain only — never wildcard `*` in production
- Rate limiting configured on all auth and form endpoints via Cloudflare
- SMTP credentials stored server-side only via Supabase Vault — never in the client bundle

### CLAUDE.md
- Update this file at the end of every session
- Document the current state: what works, what doesn't, known issues
- Record any stack decisions or architectural changes made during the session
- Prompt to trigger: `Update CLAUDE.md to reflect today's work`

---

## Environment Variables

| Variable | Source |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `VITE_GEMINI_API_KEY` | Google AI Studio → API Keys (free tier, gemini-1.5-flash) |
| `VITE_APP_URL` | Cloudflare Pages → custom domain (e.g. `https://sales.didreamlabs.com`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API — Edge Functions only, never client |
| `COMPANIES_HOUSE_API_KEY` | Companies House Developer Hub — free registration |
| `GOOGLE_PLACES_API_KEY` | Google Cloud Console → Places API — $200/month free credit |

---

## Key Files

| File | Purpose |
|---|---|
| `src/lib/supabase.ts` | Supabase client with typed DB schema |
| `src/types/index.ts` | All shared interfaces (Lead, LeadNote, Profile, Stage, NoteType, etc.) |
| `src/hooks/useAuth.tsx` | Auth context, role guard, contractor vs admin |
| `supabase/migrations/001_initial_schema.sql` | Full DB schema — all tables, RLS policies |
| `src/lib/utils.ts` | STAGES order, date/currency helpers, due/overdue logic |
| `src/lib/leadUpdates.ts` | Single lead-mutation path — auto-logs stage changes to lead_notes |
| `src/lib/leadFilters.ts` | List-view filter + sort logic (unit-tested) |
| `src/hooks/useLeads.ts` | Pipeline CRUD + realtime subscription |
| `src/hooks/useLeadNotes.ts` | Notes per lead; call notes bump call_count/last_contacted_at |
| `supabase/functions/admin-users/` | Edge function: invite users, set roles (service-role only) |
| `SPEC.md` | Full product spec — feature detail, schema, routes, design system |

---

## Current Status (updated 2026-09-02)
**Working:** Cycle 1-2 (single-tenant foundation, full pipeline, email automation incl. AI-personalised
composer/sequences/review queue) — see prior status below, all still functional. **Cycle 3 (multi-tenant
foundation), Phase B (RLS cutover) is COMPLETE** — Tasks 1-11 done, controller-verified, and pushed (Task
11 pending this session's push, see below): `organizations`/`org_members` schema, `useOrg` hook + org
switcher, org-scoped `admin-users` edge fn + admin panel, org-level BYO API keys (`org_api_settings`,
Vault-stored, live-validated), Google Sign-In (invite-only), and org-scoped RLS on every table (`leads`,
`lead_notes`, `email_templates`, `email_sequences`, `sequence_enrollments`, `email_logs`, `scrape_jobs`,
`raw_leads`, `profiles`) — no legacy global-role code path remains anywhere in the app; `profiles.role` and
`is_admin()` are gone entirely, superseded by `org_members.role` + `is_org_admin`/`is_org_member`.
AI_MODEL is `gemini-3.6-flash` (2.5-flash was retired by Google mid-cycle-3, silently broke all AI features
until caught in Task 5). Four orgs live: **Mr Brush & Co** and **DI Dreamlabs** (Kevin-owned, priority,
`use_global_api_fallback=true` — fall back to Kevin's global keys if org hasn't configured its own),
**UX Tree** (Valentina-owned) and **Digital Influx Academy** (Suj-owned) (`use_global_api_fallback=false`
— must configure their own API keys before AI/scraper features activate; this is the actual mechanism
that guarantees Kevin never pays for their usage). Org names were corrected 2026-09-01 (was "Digital
Influx"/"Digital Influx Dreamlabs", now "Digital Influx Academy"/"DI Dreamlabs") — renamed directly in the
DB, no code changes needed since the UI renders org names dynamically. `ai.ts`'s email-drafting prompt no
longer hardcodes "Digital Influx Dreamlabs" as the sender — takes `orgName` per-org now. Org-level API key
setup (`OrganizationSettings.tsx`) has a guided, non-technical-friendly flow (get-the-key buttons,
plain-English framing, numbered mini-guide for Gemini) — Google OAuth consent was explicitly rejected for
this (researched: needs Google's restricted-scope app verification, weeks of lead time, still requires the
org to have its own GCP project — no easier for non-technical admins than a good guided key-paste flow).

**Task 11 (`5cfe18b`, 2026-09-02) — the highest-risk task of the cycle**, dropped `profiles.role` and
`is_admin()` permanently (irreversible without a DB restore, unlike Tasks 8-10's reversible policy swaps).
Handled with extra care: subagent stopped before touching the live DB at all (not even one apply attempt),
controller independently re-verified the plan's grep-verify safety check plus an extra check comparing
`org_members.role` against `profiles.role` for every live user (zero drift, confirmed safe to drop),
Kevin ran the apply directly, then a full-app browser walkthrough (Dashboard, Pipeline, LeadPanel
Assignment, Emails hub, Settings, Admin panel) confirmed zero regressions before committing.

**Process notes (2026-09-02):**
- The Claude Code auto-mode classifier blocks destructive live-DB SQL from a *subagent's* sandbox even
  after Kevin approves the equivalent action in the main session — per-session permission boundaries mean
  a subagent's blocked action can't be authorized cross-session. Fix: the controller (main session) builds
  the exact SQL/script, Kevin runs it himself via `!`, the controller verifies the result, then resumes the
  subagent (or, for Task 11, does the rest directly). Edge function deploys were NOT blocked by the same
  classifier (Task 10 deployed `check-sequences`/`send-email` without incident).
- PowerShell's `ConvertTo-Json` corrupts multi-line SQL strings when piped into `Invoke-RestMethod` (hit
  during Task 9) — use a small Node script with `JSON.stringify` + the built-in `https` module instead for
  any future apply scripts; this pattern worked cleanly for Tasks 9, 10, and 11.

**In progress:** Nothing — Phase B complete. Next up is Task 12 (full multi-tenant RLS audit + docs), not
yet started.
**Not yet started:** Task 12 (full multi-tenant RLS audit + docs), lead scraper, analytics,
Cloudflare Pages deploy, outreach automation (spec exists at
`C:\Users\kevin\Downloads\dreamlabs-sales-outreach-spec.md`, needs updating for the 4-org model — was
written for 2 orgs — before it's build-ready; scheduled after cycle 3 finishes). Outreach AI drafting
model split (Gemini for internal/background AI, a smarter model — Sonnet or Haiku, undecided — for
outreach content specifically) is agreed in principle but not implemented; `draftEmail()` was built as a
swappable interface in cycle 2 specifically to allow this later.
**Known issues / pending human steps:** Kevin's SMTP credentials not yet entered for the DI Dreamlabs org
(/settings/email → save + test; until then sends return a friendly settings-gate error). Sequence steps
are limited to the 5 default templates (custom templates can't be steps yet). check-sequences insert+advance
is not transactional (worst case: a duplicate draft appears in the review queue after a mid-run crash —
self-healing since nothing auto-sends). Kanban within-column reordering deferred. Production bundle exceeds
Vite's 500 kB chunk warning — consider route-level code-splitting. Full triage list in
`docs/CYCLE3-BACKLOG.md`.

---

## Do Not Touch
- `SPEC.md` — do not edit during Claude Code sessions; it is the source of truth for product decisions
- `supabase/migrations/001_initial_schema.sql` — once run against production, never edit directly; create new migrations
- `.env` — never commit, never paste contents into chat
- RLS policies on all tables — do not disable, even temporarily for debugging
- The `role` column on `profiles` — only the service role key may write this column; never expose role assignment to the client
