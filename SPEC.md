# Dreamlabs Sales — Product Specification (MVP)

**Version:** 1.0  
**Owner:** Kevin Zamora-Saenz, Digital Influx Dreamlabs Ltd  
**Stack:** React 18 + TypeScript + Vite + Tailwind CSS + Supabase + Cloudflare Pages  
**Deployment target:** `sales.didreamlabs.com`  
**Status:** Pre-build. This document is the source of truth. Do not override decisions made here without updating this file first.

---

## 1. Product Overview

Dreamlabs Sales is a standalone sales operations tool built for Kevin (admin) and commission-based sales contractors (Eszter, Martina, Claudia, and future hires). It replaces the current patchwork of Google Sheets, cold-call notes, and manual email follow-ups with one focused tool.

Three modules:

1. **Lead Scraper** — User describes their ICP, the AI converts it to search parameters, and the app queries multiple data sources to return a list of qualified prospects. The user reviews and approves leads before they enter the pipeline.
2. **Sales Pipeline** — Kanban board and list view with colour-coded stages, expandable lead cards, drag-and-drop, next-action system, and call note logging.
3. **Email Automation** — Note-driven AI email drafting, pre-built templates, sequence builder, and SMTP send from the user's own email address. Review-before-send always.

Design principle: every decision prioritises cognitive ease. ADHD and dyslexia-friendly by default, not as an afterthought.

Future: the architecture will serve as a white-label template for Dreamlabs client products.

---

## 2. Users and Roles

### Role: Admin (Kevin)
- Full access to all leads, scrape jobs, email logs, and sequences
- Can view and edit all contractor records
- Access to `/admin` panel: user management, assignment, global analytics
- Can assign or reassign leads to contractors
- Sees all leads in pipeline regardless of who created them
- Can create and manage shared email templates and sequences

### Role: Contractor (e.g. Eszter, Martina, Claudia)
- Sees only leads they created (`created_by = auth.uid()`) or are assigned to (`assigned_to = auth.uid()`)
- Can scrape leads, approve leads into their own pipeline, log notes, draft and send emails
- Cannot see other contractors' leads
- Cannot access `/admin`
- Cannot delete leads (soft-archive only via stage = 'lost')

### Auth pattern
Supabase Auth with email/password. On sign-up, admin manually sets role via admin panel (no self-registration for contractor accounts). Role stored in `profiles.role`.

RLS enforces role separation at the database level — the frontend role check is UX only, the database is the security boundary.

---

## 3. Database Schema

Run as `supabase/migrations/001_initial_schema.sql`.

```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- PROFILES (extends auth.users)
-- ─────────────────────────────────────────
CREATE TABLE profiles (
  id            UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email         TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'contractor'
                  CHECK (role IN ('admin', 'contractor')),
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: users can read their own profile; admins read all
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self_read"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_admin_read"  ON profiles FOR SELECT USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);
CREATE POLICY "profiles_self_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- ─────────────────────────────────────────
-- USER EMAIL SETTINGS (SMTP, stored server-side)
-- ─────────────────────────────────────────
CREATE TABLE user_email_settings (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  provider       TEXT DEFAULT 'gmail' CHECK (provider IN ('gmail','outlook','yahoo','smtp')),
  smtp_host      TEXT,
  smtp_port      INTEGER DEFAULT 587,
  smtp_user      TEXT,
  -- smtp_pass stored encrypted via Supabase Vault, never in this column
  from_name      TEXT,
  is_verified    BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_email_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_settings_own" ON user_email_settings
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- SCRAPE JOBS
-- ─────────────────────────────────────────
CREATE TABLE scrape_jobs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by      UUID REFERENCES profiles(id),
  icp_raw_input   TEXT,                    -- the user's natural language ICP description
  icp_params      JSONB,                   -- structured params after AI parsing
  sources         TEXT[] DEFAULT ARRAY['google_places'], -- ['google_places','companies_house']
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed')),
  results_count   INTEGER DEFAULT 0,
  approved_count  INTEGER DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE scrape_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scrape_jobs_own"   ON scrape_jobs FOR ALL USING (auth.uid() = created_by);
CREATE POLICY "scrape_jobs_admin" ON scrape_jobs FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);

-- ─────────────────────────────────────────
-- RAW LEADS (pre-approval holding area)
-- ─────────────────────────────────────────
CREATE TABLE raw_leads (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scrape_job_id   UUID REFERENCES scrape_jobs(id) ON DELETE CASCADE,
  business_name   TEXT NOT NULL,
  owner_name      TEXT,
  phone           TEXT,
  email           TEXT,
  website         TEXT,
  address         TEXT,
  city            TEXT,
  postcode        TEXT,
  google_rating   DECIMAL(2,1),
  review_count    INTEGER,
  vertical        TEXT,
  source          TEXT,                    -- 'google_places' | 'companies_house' | 'google_search'
  source_id       TEXT,                    -- Google Place ID or Companies House number
  raw_data        JSONB,                   -- full API response stored for debugging
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','duplicate')),
  duplicate_of    UUID REFERENCES raw_leads(id),
  approved_by     UUID REFERENCES profiles(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE raw_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "raw_leads_own"   ON raw_leads FOR ALL USING (
  EXISTS (SELECT 1 FROM scrape_jobs WHERE id = raw_leads.scrape_job_id AND created_by = auth.uid())
);
CREATE POLICY "raw_leads_admin" ON raw_leads FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);

-- ─────────────────────────────────────────
-- PIPELINE LEADS
-- ─────────────────────────────────────────
CREATE TABLE leads (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_name     TEXT NOT NULL,
  owner_name        TEXT,
  phone             TEXT,
  email             TEXT,
  website           TEXT,
  address           TEXT,
  city              TEXT,
  postcode          TEXT,
  google_rating     DECIMAL(2,1),
  review_count      INTEGER,
  vertical          TEXT,
  stage             TEXT DEFAULT 'new_lead'
                      CHECK (stage IN (
                        'new_lead','contacted','audit_booked','proposal_sent',
                        'negotiating','won','lost','not_now_nurture'
                      )),
  package_tier      TEXT CHECK (package_tier IN (
                      'pilot_systems','pilot_ai_app','pilot_full_build',
                      'automation_sprint','ai_foundation','full_build',
                      'retainer_bronze','retainer_silver','retainer_gold','custom'
                    )),
  deal_value        DECIMAL(10,2),
  assigned_to       UUID REFERENCES profiles(id),
  created_by        UUID REFERENCES profiles(id),
  raw_lead_id       UUID REFERENCES raw_leads(id),
  next_action_date  DATE,
  next_action_note  TEXT,
  call_count        INTEGER DEFAULT 0,
  last_contacted_at TIMESTAMPTZ,
  kanban_position   INTEGER DEFAULT 0,     -- ordering within a stage column
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads_own" ON leads FOR ALL USING (
  auth.uid() = created_by OR auth.uid() = assigned_to
);
CREATE POLICY "leads_admin" ON leads FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────
-- LEAD NOTES
-- ─────────────────────────────────────────
CREATE TABLE lead_notes (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id            UUID REFERENCES leads(id) ON DELETE CASCADE,
  created_by         UUID REFERENCES profiles(id),
  content            TEXT NOT NULL,
  note_type          TEXT DEFAULT 'general'
                       CHECK (note_type IN ('call','email','meeting','general','ai_summary')),
  ai_extracted_data  JSONB,               -- structured data the AI pulled from the note
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE lead_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes_lead_access" ON lead_notes FOR ALL USING (
  EXISTS (
    SELECT 1 FROM leads
    WHERE id = lead_notes.lead_id
    AND (created_by = auth.uid() OR assigned_to = auth.uid())
  )
);
CREATE POLICY "notes_admin" ON lead_notes FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);

-- ─────────────────────────────────────────
-- EMAIL TEMPLATES
-- ─────────────────────────────────────────
CREATE TABLE email_templates (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,           -- supports {{variable}} placeholders
  template_type  TEXT DEFAULT 'custom'
                   CHECK (template_type IN (
                     'initial_followup','second_chase','not_now_nurture',
                     'audit_confirmation','proposal_followup','custom'
                   )),
  is_default     BOOLEAN DEFAULT false,   -- default templates seeded at setup, visible to all
  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "templates_read_all"   ON email_templates FOR SELECT USING (is_default = true OR auth.uid() = created_by);
CREATE POLICY "templates_own_write"  ON email_templates FOR ALL USING (auth.uid() = created_by);
CREATE POLICY "templates_admin"      ON email_templates FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);

-- ─────────────────────────────────────────
-- EMAIL SEQUENCES
-- ─────────────────────────────────────────
CREATE TABLE email_sequences (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  -- steps: [{step: 1, delay_days: 0, template_id: "uuid", subject_override: null}]
  steps        JSONB NOT NULL DEFAULT '[]',
  is_default   BOOLEAN DEFAULT false,
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sequences_read"  ON email_sequences FOR SELECT USING (is_default = true OR auth.uid() = created_by);
CREATE POLICY "sequences_write" ON email_sequences FOR ALL USING (auth.uid() = created_by);
CREATE POLICY "sequences_admin" ON email_sequences FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);

-- ─────────────────────────────────────────
-- SEQUENCE ENROLLMENTS
-- ─────────────────────────────────────────
CREATE TABLE sequence_enrollments (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id        UUID REFERENCES leads(id) ON DELETE CASCADE,
  sequence_id    UUID REFERENCES email_sequences(id),
  current_step   INTEGER DEFAULT 1,
  next_send_at   TIMESTAMPTZ,
  status         TEXT DEFAULT 'active'
                   CHECK (status IN ('active','paused','completed','cancelled')),
  enrolled_by    UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "enrollments_own"   ON sequence_enrollments FOR ALL USING (auth.uid() = enrolled_by);
CREATE POLICY "enrollments_admin" ON sequence_enrollments FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);

-- ─────────────────────────────────────────
-- EMAIL LOGS
-- ─────────────────────────────────────────
CREATE TABLE email_logs (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id                 UUID REFERENCES leads(id) ON DELETE SET NULL,
  sequence_enrollment_id  UUID REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
  sent_by                 UUID REFERENCES profiles(id),
  to_email                TEXT NOT NULL,
  subject                 TEXT NOT NULL,
  body                    TEXT NOT NULL,
  status                  TEXT DEFAULT 'sent'
                            CHECK (status IN ('draft','sent','failed')),
  error_message           TEXT,
  sent_at                 TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "logs_own"   ON email_logs FOR ALL USING (auth.uid() = sent_by);
CREATE POLICY "logs_admin" ON email_logs FOR ALL USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
);
```

---

## 4. Supabase Edge Functions

All server-side logic (scraping, AI, email) runs in Supabase Edge Functions (Deno runtime). The client never calls third-party APIs directly — all secrets stay server-side.

### `scrape-google-places`
- Accepts: `{ icp_params, job_id }`
- Calls Google Places API (Text Search) with ICP-derived search query
- Fetches: name, formatted_phone_number, website, formatted_address, rating, user_ratings_total, place_id
- For each result, attempts to find a contact email by fetching the business website and parsing `mailto:` links or `contact` page
- Writes results to `raw_leads` table
- Updates `scrape_jobs.status` to `completed` or `failed`
- Rate limit: 10 requests/second, max 60 results per job (pagination supported)

### `scrape-companies-house`
- Accepts: `{ company_name?, postcode?, sic_code?, job_id }`
- Calls Companies House Search API (free, requires API key from developer.company-information.service.gov.uk)
- Returns: company name, registered address, SIC codes, officer names (potential owner)
- Writes results to `raw_leads` table as source = `companies_house`

### `parse-icp`
- Accepts: `{ raw_input: string }`
- Calls Gemini 1.5 Flash API
- System prompt: "You are an ICP parser for a B2B sales tool targeting UK SMEs. Convert the user's natural language ICP description into a structured JSON search parameter object."
- Returns structured JSON: `{ industry, location, city, min_staff, min_rating, max_rating, max_reviews, keywords, sources_to_use }`
- Used before a scrape job is created

### `parse-notes`
- Accepts: `{ lead_id, notes: string }`
- Calls Gemini 1.5 Flash API with the call notes
- System prompt: extracts pain points, objections raised, promises made, recommended next action, and sentiment
- Updates `lead_notes` table with `note_type = 'ai_summary'` and `ai_extracted_data`
- Also updates `leads.next_action_note` if a clear next step was extracted

### `generate-email`
- Accepts: `{ lead_id, template_id, notes_summary, tone_override? }`
- Fetches lead data + template body
- Calls Gemini 1.5 Flash to personalise template using lead context and call notes
- Replaces `{{variable}}` placeholders with real data
- Returns `{ subject, body }` draft — never sends automatically

### `send-email`
- Accepts: `{ log_id, to_email, subject, body, user_id }`
- Fetches SMTP credentials from Supabase Vault by `user_id`
- Sends via Nodemailer (supports Gmail, Outlook, Yahoo, custom SMTP)
- Writes result to `email_logs.status`
- Called only after user has reviewed and confirmed the draft

### `check-sequences` (scheduled — daily cron via pg_cron)
- Queries `sequence_enrollments` where `status = 'active'` and `next_send_at <= NOW()`
- For each due enrollment, fetches next step's template, generates draft via `generate-email`, creates a `email_logs` entry with `status = 'draft'` for user review
- Does NOT send automatically — generates drafts into the "Ready to send" queue in the UI
- Advances `current_step` and recalculates `next_send_at`

---

## 5. Module 1: Lead Scraper

### User Flow
1. User navigates to `/scraper` → sees a clean ICP entry screen
2. **Step 1 — Describe your ideal customer** (free text area, large): "Commercial cleaning companies in London, 10–30 staff, Google rating between 3.0 and 4.2, fewer than 30 reviews."
3. **Step 2 — AI parses ICP** → shows the interpreted parameters for confirmation: Location: London | Industry: Commercial Cleaning | Min Staff: 10 | Rating Range: 3.0–4.2 | Max Reviews: 30
4. User can adjust individual parameters before running
5. **Step 3 — Choose data sources** (checkboxes): Google Places (primary), Companies House (UK only)
6. **Step 4 — Confirm and scrape** → creates `scrape_job` record, triggers Edge Functions, shows live progress indicator
7. Results land in `/scraper/jobs/:id` — a scrollable review table

### Approval Flow (at `/scraper/jobs/:id`)
- Table shows all `raw_leads` for the job with status = `pending`
- Columns: Business Name, Phone, Email, Rating, Reviews, City, Source, Duplicate?
- Duplicate detection: if `business_name + city` or `email` matches any existing `leads` or pending `raw_leads`, flag row in amber with a "Possible duplicate" badge
- User actions per row: **Approve** (moves to pipeline as `new_lead`) | **Reject** | **Skip for now**
- Bulk actions: Approve All, Reject All selected
- Export button: **Download CSV** of all results (approved or all, user chooses)

### ADHD Design Notes
- Progress bar shows scrape job status in real time (Supabase real-time subscription on `scrape_jobs.status`)
- Step wizard has numbered progress indicator (Step 1 of 4)
- Confirmed parameters shown as chips/badges before scrape runs — prevents "did it actually pick up what I meant?" anxiety
- Duplicate flagging is visual (amber row highlight + icon) not just text

---

## 6. Module 2: Sales Pipeline

### Pipeline Stages

| Stage | Colour | Hex | Meaning |
|---|---|---|---|
| New Lead | Slate | `#94A3B8` | In the system, not yet contacted |
| Contacted | Violet | `#8B32FF` | First outreach made |
| Audit Booked | Cyan | `#00DFDF` | Free Business Audit scheduled |
| Proposal Sent | Amber | `#F59E0B` | Proposal delivered, awaiting response |
| Negotiating | Orange | `#F97316` | Active commercial discussion |
| Won | Green | `#22C55E` | Signed — client |
| Lost | Red | `#EF4444` | Closed, no deal |
| Not Now / Nurture | Purple | `#64378B` | Soft no — check back in 30-90 days |

Every stage uses: colour-coded left border on card + colour-coded badge + icon (no colour-only information).

### Kanban View (`/pipeline/kanban`)
- 8 columns, horizontally scrollable on desktop
- Drag-and-drop between columns (using `@dnd-kit/core` library)
- Cards also allow stage change from inside the expanded card view
- **Compact card (default state):**
  - Company name (Montserrat Bold, 14px)
  - Phone number (clickable `tel:` link on mobile)
  - Email (truncated, copyable on click)
  - Next action indicator: if `next_action_date` is today or overdue, show a red dot + relative date ("2 days overdue")
  - Assigned contractor avatar (if assigned)
- **Expanded card (click to open):**
  - All compact fields
  - Owner name
  - Website link
  - Google rating + review count
  - Vertical / industry
  - Package tier + deal value
  - Next action date (editable inline)
  - Call count
  - Last contacted date
  - Notes preview (last 2 notes, "See all" link)
  - Email log preview (last email sent)
  - Stage change dropdown
  - Action buttons: Log Note, Draft Email, Enroll in Sequence, Assign To

### List View (`/pipeline/list`)
- Full-width table with sticky header
- Columns (all sortable): Company, Owner, Phone, Email, Stage, Package, Value, Assigned To, Next Action, Last Contacted
- Search bar: fuzzy search on company name, owner name, email
- Filters: Stage (multi-select), Assigned To (multi-select), Vertical (multi-select), Overdue Only (toggle)
- Sort: click any column header
- Row click opens the expanded lead detail side panel (slides in from right, doesn't navigate away)

### Lead Detail Page (`/pipeline/leads/:id`)
Full-page view for a single lead. Sections:
1. **Header** — company name, stage badge, assigned contractor, deal value
2. **Contact info** — phone (tel: link), email (mailto: link), website, address
3. **Pipeline info** — package tier, deal value, vertical, Google rating
4. **Next Action** — date picker + note field (edit and save inline)
5. **Notes timeline** — all notes in chronological order, each showing author, timestamp, note type icon, content. "Add note" opens a split input: (a) structured debrief form, (b) free text, (c) AI parse toggle
6. **Email log** — all emails sent to this lead, with subject, date, status
7. **Sequences** — active sequence enrollment + step, pause/cancel controls
8. **Activity history** — auto-logged stage changes with timestamp

### Next Action System
- Every lead can have a `next_action_date` and `next_action_note`
- Dashboard widget "Today's Follow-Ups" surfaces all leads where `next_action_date = today`
- Overdue badge on lead cards: if `next_action_date < today`, card gets a red "Overdue" indicator
- When user completes a next action, they log a note → system prompts "Set your next action date" before closing

### Note Input — Structured Debrief (ADHD-Friendly)
When user clicks "Log Note" on a lead, they see two tabs:

**Tab A: Quick debrief (guided)**
Step-by-step, one question per screen:
1. "How did the call go?" (3 buttons: Positive / Neutral / Negative)
2. "What was their main pain point?" (free text, pre-filled with stage-specific examples)
3. "Did they raise any objections?" (free text)
4. "What did you promise to follow up with?" (free text)
5. "What's the next step?" (date picker + note)
6. Optional: "Add any other notes" (free text)

On submit: all answers are compiled into a single note, AI parses it, and the lead fields are updated accordingly.

**Tab B: Free text**
Single large text area. "Paste your session notes here. AI will extract key details and update the lead." After submit, AI parse runs in background.

Both tabs: AI parse is opt-in toggle ("Let AI update this lead from your notes" checkbox — on by default).

---

## 7. Module 3: Email Automation

### Email Config (`/settings/email`)
Non-technical setup. UI shows:
1. "Select your email provider" — dropdown: Gmail, Outlook/Hotmail, Yahoo, Other (custom SMTP)
2. For Gmail: step-by-step instructions with numbered steps and screenshots placeholder:
   - "Step 1: Go to your Google Account → Security → 2-Step Verification (must be on)"
   - "Step 2: Search for 'App Passwords' in your Google Account settings"
   - "Step 3: Create a new App Password — name it 'Dreamlabs Sales'"
   - "Step 4: Paste the 16-character password below"
   - Input fields: Your Gmail address | App Password (masked, shown as ••••••••)
3. For Outlook: similar but simpler — standard SMTP credentials
4. "Send test email" button — sends a test to the user's own address to confirm it works
5. Credentials stored via Supabase Vault (server-side encrypted) — never in `user_email_settings` table directly

### Email Templates (`/emails/templates`)
Five pre-seeded default templates (is_default = true):

**1. Initial Follow-Up (48h post-proposal)**
Subject: `Following up — {{business_name}}`
Tone: warm, direct, no fluff

**2. Second Chase (7 days)**
Subject: `Quick check-in — {{business_name}}`
Tone: brief, respectful

**3. Not Now Nurture (30-day check-in)**
Subject: `Checking back in — {{business_name}}`
Tone: genuinely low-pressure, value-first

**4. Audit Confirmation**
Subject: `Your Free Business Audit — confirmed for {{audit_date}}`
Tone: professional, confidence-building

**5. Proposal Follow-Up (custom context)**
Subject: `Your Dreamlabs proposal — {{business_name}}`
Tone: based on call notes

All templates support `{{variable}}` syntax. Available variables: `{{first_name}}`, `{{business_name}}`, `{{owner_name}}`, `{{audit_date}}`, `{{package_name}}`, `{{deal_value}}`, `{{contractor_name}}`, `{{pain_point}}`, `{{cal_link}}`.

Users can create custom templates. Admins can mark any template as `is_default` to make it visible to all contractors.

### Email Composer
Accessed via lead card "Draft Email" button or from `/emails/templates`:
1. Dropdown: select a base template
2. AI personalisation: AI uses lead data + latest call note to personalise the template. Diff view shows original vs AI-edited (colour coded additions/removals)
3. User edits the draft (full rich text, but plain text by default — HTML emails are harder to land in inbox)
4. Subject line editable
5. Preview panel: "This is how it will appear in the recipient's inbox"
6. **Send** button → calls `send-email` Edge Function → logs to `email_logs`

### Sequence Builder (`/emails/sequences`)
- List of sequences (default: "Proposal Follow-Up" and "Not Now Nurture" pre-seeded)
- "New Sequence" button opens builder:
  1. Name the sequence
  2. Add steps: each step is a card with: Delay (in days from previous step, or from enrollment), Template (dropdown), Subject override (optional)
  3. Drag to reorder steps
  4. Preview timeline: visual representation of when each email would send ("Day 0: Email 1, Day 2: Email 2, Day 7: Email 3")
- Enroll a lead: from lead card → "Enroll in Sequence" → pick sequence → confirms enrollment date
- Active enrollments show step progress on the lead card
- Sequence emails land in a "Ready to Review" queue — user reviews and confirms each before it sends

### Email Log (`/emails/logs`)
Table showing all sent emails:
- Columns: Date, Lead, Company, Subject, Sent By, Status
- Click to expand and see the full email body
- Filter by lead, by contractor, by date range
- Export as CSV

---

## 8. Dashboard — Today's Focus

Route: `/` (home page after login)

Designed as the first thing a user sees every day. Chunked, scannable, low cognitive load.

### Sections

**1. Good morning, [Name]** — personalised greeting, today's date

**2. Stats Bar** (horizontal, 4 cards)
- Leads in pipeline (total)
- Follow-ups due today
- Emails in review queue
- Calls made this week (manual input or inferred from call notes)

**3. Today's Follow-Ups** (most important section)
Cards showing all leads with `next_action_date = today`. Each card shows: company name, stage badge, next action note, phone (click to call). Overdue follow-ups from previous days shown first in red.

**4. Emails Ready to Review**
Drafts generated by the sequence scheduler waiting for user confirmation. Compact list: company name, subject line, "Review & Send" button.

**5. Recently Active Leads**
Last 5 leads that were updated (any activity). Quick re-entry into live conversations.

**6. Pipeline Snapshot** (mini Kanban — visual only, read only)
Count of leads in each stage, colour coded. Tapping a stage navigates to filtered pipeline view.

### Focus Mode
Toggle in top-right: hides the sidebar and reduces the dashboard to just "Today's Follow-Ups" and "Emails Ready to Review". Designed for users who want zero distraction during calling sessions.

---

## 9. Analytics Dashboard

Route: `/analytics` (visible to all users, filtered by role — admins see all, contractors see their own)

### Metrics
- Total leads scraped this month
- Leads by stage (bar chart)
- Conversion rate: Contacted → Audit Booked, Audit Booked → Proposal Sent, Proposal → Won
- Average time in each stage (days)
- Emails sent this month (by contractor if admin view)
- Won deals this month: count + total value (£)
- Leads by vertical (pie/donut chart)
- Leads by contractor (admin only — who's contributing what)

### Charts
Use `recharts` library (already in the Dreamlabs stack). Keep charts simple — bar and donut only for MVP. No line charts unless time-series data is meaningful.

---

## 10. Admin Panel

Route: `/admin` (admin role only, RLS-enforced)

**User Management:**
- Table of all users: Name, Email, Role, Created At, Last Sign In
- "Invite Contractor" button: generates a magic link or sends Supabase invite email
- Edit role (admin/contractor)
- Deactivate account (sets `is_active = false`, blocks sign-in)

**Lead Assignment:**
- View all unassigned leads
- Bulk assign to a contractor

---

## 11. Brand & Design System

### Palette

| Token | Name | Hex |
|---|---|---|
| `--color-navy` | Deep Navy | `#040F49` |
| `--color-violet` | Violet Ray | `#8B32FF` |
| `--color-purple` | Rebecca Purple | `#64378B` |
| `--color-magenta` | Magenta Bloom | `#F0386B` |
| `--color-cyan` | Strong Cyan | `#00DFDF` |
| `--color-offwhite` | Off White | `#F4F4F8` |

App background: `#09102E` (near-black navy — dark mode only for MVP)
Card background: `#0F1A5E` lightened to `#111C6A` 
Surface elevated: `#1A2575`
Border: `rgba(255,255,255,0.08)`
Text primary: `#F4F4F8`
Text muted: `rgba(244,244,248,0.55)`

### Typography

| Role | Font | Weight | Size |
|---|---|---|---|
| Heading 1 | Montserrat | 800 | 28px |
| Heading 2 | Montserrat | 700 | 22px |
| Heading 3 | Montserrat | 700 | 18px |
| Body | DM Sans | 400 | 16px |
| Body small | DM Sans | 400 | 14px |
| Label / Badge | DM Sans | 600 | 12px |
| Button | DM Sans | 600 | 15px |

Line height: 1.6 on body text. Letter spacing: 0.02em on body.

Self-host both fonts from `/assets/fonts/` — do not use Google Fonts CDN in production.

### ADHD + Dyslexia Design Rules

1. **No colour-only information.** Every status/stage uses icon + colour + label. Never just a coloured dot.
2. **Minimum tap target: 44×44px.** All buttons, links, interactive elements.
3. **Expandable cards default to compact.** Only the most critical information visible at rest: company name, phone, email. Full detail on click/tap.
4. **Focus mode.** Top-right toggle strips back to the single most important task list.
5. **Progress indicators on all multi-step flows.** "Step 2 of 4" with a progress bar and back button always visible.
6. **Chunked forms.** Never more than 3 fields visible at once in a step. One question per screen in the structured debrief.
7. **Overdue = unmissable.** Red dot + "X days overdue" label on every overdue item. Not just a slightly different shade.
8. **Reduced motion.** Respect `prefers-reduced-motion`. Disable drag animations, slide transitions, and fade-ins when this is enabled.
9. **Font size floor: 16px body.** Never smaller. Badge labels at 12px max.
10. **High contrast.** WCAG AA minimum (4.5:1 contrast ratio). Dark navy background gives this for free with Off White text.
11. **One primary action per screen.** The most important button is always the largest and the most prominent colour (Violet Ray or Cyan).
12. **Skeleton loaders, not spinners.** Show a shimmer layout placeholder while data loads — gives the brain a context anchor.
13. **Inline save, not modal forms.** Where possible, fields edit inline with an auto-save indicator. Modals are for destructive actions only.

---

## 12. Mobile Experience

Mobile is **note-taking first**. Full pipeline management is desktop only.

### Mobile routes (accessible and fully styled)
- `/` (dashboard) — Today's Focus only, simplified
- `/pipeline` — List view only (no Kanban on mobile)
- `/pipeline/leads/:id` — Full lead detail, optimised for vertical scroll
- `/settings/email` — Email config

### Mobile-specific features
- Sticky "Add Note" FAB (floating action button) on lead detail page — opens the structured debrief form fullscreen
- Phone numbers are always `tel:` links on mobile
- Email addresses are always `mailto:` links on mobile
- Notes input uses a large text area with 18px font minimum to avoid auto-zoom on iOS

### Mobile-not-available
- Kanban drag-and-drop
- Scraper ICP wizard (too complex for small screen in MVP)
- Sequence builder
- Analytics charts

Show a friendly message on mobile for these routes: "This feature works best on desktop. Your progress is saved — come back on a bigger screen to access the full pipeline builder."

---

## 13. Route Structure

```
/login                        → Auth (email + password)
/                             → Dashboard (Today's Focus)
/scraper                      → Scraper home — recent jobs + New Scrape button
/scraper/new                  → ICP wizard (4 steps)
/scraper/jobs                 → All scrape jobs history
/scraper/jobs/:id             → Job results + approval table
/pipeline                     → Pipeline — defaults to Kanban, persists toggle choice
/pipeline/kanban              → Kanban view
/pipeline/list                → List view
/pipeline/leads/:id           → Full lead detail page
/emails                       → Email hub — templates, sequences, logs tabs
/emails/templates             → Template library
/emails/templates/new         → Create template
/emails/templates/:id/edit    → Edit template
/emails/sequences             → Sequence library
/emails/sequences/new         → Sequence builder
/emails/sequences/:id/edit    → Edit sequence
/emails/logs                  → Email send history
/analytics                    → Analytics dashboard
/settings                     → Settings home
/settings/profile             → Profile (name, avatar)
/settings/email               → SMTP email config
/admin                        → Admin panel (admin role only)
/admin/users                  → User management
```

---

## 14. MVP Build Order

Build in this sequence — each phase is independently testable.

### Phase 1 — Foundation (build first, nothing works without this)
1. Supabase project + schema migration (`001_initial_schema.sql`)
2. Auth: login page, Supabase auth, session persistence
3. Route structure with role guards (admin vs contractor)
4. App shell: sidebar nav, topbar, page layout, mobile breakpoints
5. Profile creation on first sign-in
6. Admin: invite user + set role

### Phase 2 — Pipeline Tracker (highest immediate value for Kevin)
1. Lead model + CRUD (create, read, update lead)
2. Kanban board — 8 columns, colour coded, drag-and-drop
3. List view — sortable, filterable, searchable
4. Compact card (default) + expanded card
5. Lead detail page — all sections
6. Note logging — free text tab first, then structured debrief
7. Next action system — date picker, overdue detection, dashboard widget

### Phase 3 — Dashboard
1. Today's Focus widget (overdue + today's follow-ups)
2. Stats bar
3. Pipeline snapshot (stage counts)
4. Focus mode toggle

### Phase 4 — Email Automation
1. SMTP config page (Gmail first)
2. `send-email` Edge Function with test send
3. Template library + default templates seeded
4. Email composer (template select → AI personalise → edit → send)
5. Email log on lead detail + `/emails/logs` page
6. Sequence builder
7. `check-sequences` cron function
8. "Ready to review" email queue on dashboard

### Phase 5 — Lead Scraper
1. `parse-icp` Edge Function (Gemini)
2. ICP wizard UI (4 steps)
3. `scrape-google-places` Edge Function
4. Scrape job status real-time subscription
5. Results table + approval flow
6. Duplicate detection
7. CSV export
8. `scrape-companies-house` Edge Function

### Phase 6 — Analytics
1. Analytics dashboard (recharts)
2. Stage conversion funnel
3. Lead counts by contractor (admin only)
4. Won deals summary

---

## 15. Third-Party API Notes

### Google Places API
- Key: `GOOGLE_PLACES_API_KEY` (server-side only, never in client)
- Endpoint: `https://maps.googleapis.com/maps/api/place/textsearch/json`
- Free credit: $200/month (~5,000 Text Search requests)
- Each search returns up to 60 results (pagination with `pagetoken`)
- Fields to request: `name`, `formatted_phone_number`, `website`, `formatted_address`, `rating`, `user_ratings_total`, `place_id`
- Enable "Places API" in Google Cloud Console

### Companies House API
- Key: `COMPANIES_HOUSE_API_KEY` (free, server-side only)
- Register at: https://developer.company-information.service.gov.uk/
- Endpoint: `https://api.company-information.service.gov.uk/search/companies`
- No cost, high rate limit (600 req/5 min)
- Returns: company name, registered office address, company status, SIC codes, officer names

### Google Gemini API
- Key: `VITE_GEMINI_API_KEY` (used in Edge Functions only despite the VITE_ prefix, which is fine because Edge Functions don't bundle client code)
- Model: `gemini-1.5-flash` (free tier: 15 RPM, 1,500 requests/day)
- Base URL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`
- Register at: https://aistudio.google.com/

### SMTP Providers (user-configured)
| Provider | SMTP Host | Port | Auth Method |
|---|---|---|---|
| Gmail | smtp.gmail.com | 587 | App Password (not account password) |
| Outlook | smtp.office365.com | 587 | Account password |
| Yahoo | smtp.mail.yahoo.com | 587 | App Password |
| Custom | User-provided | User-provided | User-provided |

---

## 16. Key Decisions Recorded

| Decision | Rationale |
|---|---|
| Dark mode only (navy) | Easier on eyes for all-day use; ADHD users report less fatigue; brand-aligned |
| Gemini free tier for AI | Zero cost; 1,500 req/day is sufficient for MVP usage; no billing risk |
| SMTP over SendGrid/Resend | Contractors send from their own email — better deliverability, no shared sender reputation, no setup friction for Kevin |
| Review-before-send always | Prevents AI email errors reaching real prospects; builds trust in the tool |
| Custom scraper (no Apify) | Avoids dependency, avoids future API cost, builds internal IP |
| Google Places as primary scraper source | Structured data, free tier, no scraping/bot-detection issues, returns the data we need |
| Companies House as secondary source | Free UK business registry; uniquely useful for the UK ICP |
| `@dnd-kit` for drag and drop | Accessibility-first library; works with keyboard navigation; maintained and stable |
| Supabase Edge Functions | Keeps all secrets server-side; no separate backend to manage; fits Supabase-first stack |
| Desktop-first, mobile note-taking only | Complexity of full mobile build is V2; mobile note input covers the highest-value field use case |
| No import of existing 186-lead list | Kevin will manually add active leads; avoid polluting the clean data model with CSV import edge cases |
