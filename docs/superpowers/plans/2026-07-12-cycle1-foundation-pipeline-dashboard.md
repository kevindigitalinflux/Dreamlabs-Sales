# Dreamlabs Sales — Cycle 1 (Foundation, Pipeline, Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working internal sales CRM at localhost — auth with admin/contractor roles, full lead pipeline (Kanban + list + detail + notes + next actions), and the Today's Focus dashboard — per `SPEC.md` §14 Phases 1–3 and the approved design doc `docs/superpowers/specs/2026-07-12-dreamlabs-sales-cycle1-design.md`.

**Architecture:** Vite SPA (React 19 + TS strict + Tailwind v4) talking directly to Supabase (Postgres + Auth + Realtime) via `supabase-js` custom hooks. RLS is the security boundary; the only server-side code is one Edge Function (`admin-users`) for privileged admin actions. Full DB schema (all 9 tables) ships now in migration 001 so later cycles are additive.

**Tech Stack:** React 19, TypeScript (strict), Vite, Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first `@theme`), react-router v7 (library mode), `@supabase/supabase-js` v2, `@dnd-kit/core`, `lucide-react`, `@fontsource/montserrat` + `@fontsource/dm-sans`, Vitest.

## Global Constraints

Copied from `CLAUDE.md` / `SPEC.md` — every task's requirements implicitly include these:

- TypeScript **strict mode**; no `any` (cast via `unknown` if unavoidable).
- **Named exports only** — no default exports anywhere.
- Components **PascalCase**, utilities **camelCase**; `.tsx` only for files containing JSX.
- Styling with **Tailwind utility classes only** — no custom CSS files, no inline `style` (exception already encoded in this plan: none needed; stage colours use literal arbitrary-value classes like `bg-[#94A3B8]/15` kept in typed `Record<Stage, string>` maps so Tailwind can see them).
- Every data-driven component handles **loading, error, and empty** states.
- Components **under 150 lines** — extract sub-components when approaching the limit.
- **JSDoc comments on all exported functions.**
- ADHD/dyslexia rules (SPEC.md §11): minimum tap target `min-h-11` (44px); body text 16px floor; every status = **icon + colour + label** (never colour alone); skeleton loaders not spinners; animations behind `motion-safe:`; one primary action per screen; progress indicators ("Step X of N") on all multi-step flows; max 3 fields per wizard step.
- Dark mode only. Palette tokens per SPEC.md §11 (defined once in `src/index.css` `@theme`).
- Commit format `feat:` / `fix:` / `refactor:` / `chore:`; commit after every task at minimum.
- Secrets in `.env` only (already gitignored). `SUPABASE_SERVICE_ROLE_KEY` never appears in client code — Edge Function env only.
- Fonts self-hosted via `@fontsource` packages (bundled locally by Vite; no CDN at runtime).
- Commands below are Git Bash syntax; project root is `C:\Users\kevin\Projects\dreamlabs-sales` (`/c/Users/kevin/Projects/dreamlabs-sales`).

**Human-in-the-loop:** Steps marked **HUMAN ACTION (Kevin)** need the Supabase dashboard or GitHub — the executor must stop and ask rather than skip.

---

### Task 1: Project scaffold, Tailwind v4 theme, GitHub remote

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.env.example`
- Create: `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: running Vite app; theme utility classes used by ALL later tasks: `bg-bg`, `bg-card`, `bg-surface`, `bg-navy`, `bg-violet`, `bg-cyan`, `bg-magenta`, `text-offwhite`, `text-muted`, `border-line`, `font-heading`, `font-body`; npm scripts `dev`, `build`, `test`.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "dreamlabs-sales",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd /c/Users/kevin/Projects/dreamlabs-sales
npm install react react-dom react-router @supabase/supabase-js lucide-react @dnd-kit/core @fontsource/montserrat @fontsource/dm-sans
npm install -D typescript vite @vitejs/plugin-react tailwindcss @tailwindcss/vite vitest @types/react @types/react-dom
```

Expected: both commands exit 0; `package.json` gains dependencies/devDependencies blocks.

- [ ] **Step 3: Write config files**

`vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>Dreamlabs Sales</title>
  </head>
  <body style="background:#09102E">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

(The single `style` attribute on `<body>` prevents a white flash before CSS loads — the one sanctioned exception, it's not a component.)

`.env.example`:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

- [ ] **Step 4: Write src files**

`src/index.css`:

```css
@import "tailwindcss";

@theme {
  --color-navy: #040F49;
  --color-violet: #8B32FF;
  --color-purple: #64378B;
  --color-magenta: #F0386B;
  --color-cyan: #00DFDF;
  --color-offwhite: #F4F4F8;
  --color-bg: #09102E;
  --color-card: #111C6A;
  --color-surface: #1A2575;
  --color-muted: rgba(244, 244, 248, 0.55);
  --color-line: rgba(255, 255, 255, 0.08);
  --font-heading: "Montserrat", ui-sans-serif, system-ui, sans-serif;
  --font-body: "DM Sans", ui-sans-serif, system-ui, sans-serif;
}

@layer base {
  body {
    @apply bg-bg font-body text-offwhite;
    font-size: 16px;
    line-height: 1.6;
    letter-spacing: 0.02em;
  }
  h1, h2, h3, h4 {
    @apply font-heading;
    line-height: 1.25;
  }
}
```

`src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import './index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/App.tsx` (temporary smoke-test content; replaced in Task 5):

```tsx
export function App() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2">
      <h1 className="text-[28px] font-extrabold">Dreamlabs Sales</h1>
      <p className="text-muted">Scaffold OK — Montserrat heading, DM Sans body, navy theme.</p>
      <span className="rounded-full bg-violet px-3 py-1 text-xs font-semibold">violet</span>
    </div>
  );
}
```

- [ ] **Step 5: Verify in browser**

Run: `npm run dev` — open http://localhost:5173
Expected: near-black navy background, off-white bold Montserrat heading, muted subtitle, violet pill. No console errors. Then stop the dev server.

Run: `npm run build`
Expected: exits 0 (tsc clean, vite build succeeds).

- [ ] **Step 6: Create GitHub repo and push**

Try: `gh repo create dreamlabs-sales --private --source . --remote origin`
If `gh` is not installed: **HUMAN ACTION (Kevin):** create a private repo `dreamlabs-sales` under your GitHub account at github.com/new (no README/gitignore), then the executor runs:

```bash
git remote add origin git@github.com:kevindigitalinflux/dreamlabs-sales.git
```

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "chore: scaffold Vite + React 19 + TS strict + Tailwind v4 theme"
git push -u origin main
```

Expected: push succeeds (SSH auth already verified on this machine).

---

### Task 2: Supabase project, schema migration 001, typed client

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`
- Create: `src/lib/supabase.ts`
- Create: `.env` (Kevin's values; never committed)

**Interfaces:**
- Consumes: `.env.example` keys from Task 1.
- Produces: `supabase` client export (`import { supabase } from '../lib/supabase'`) used by every hook; all 9 DB tables with RLS live in the hosted project.

- [ ] **Step 1: Write the migration**

`supabase/migrations/001_initial_schema.sql` — this is SPEC.md §3 verbatim **plus** the four amendments recorded in the design doc: (1) `is_admin()` SECURITY DEFINER helper replacing the recursive inline admin checks, (2) profile-creation trigger on `auth.users`, (3) column-level grants so clients can never write `profiles.role`, (4) realtime publication + pragmatic indexes.

```sql
-- Dreamlabs Sales — initial schema (SPEC.md §3 + design-doc amendments)
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

-- Amendment 1: SECURITY DEFINER helper — avoids infinite recursion when a
-- profiles policy needs to read profiles. Used by every admin policy below.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self_read"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_admin_read"  ON profiles FOR SELECT USING (is_admin());
CREATE POLICY "profiles_self_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Amendment 3: clients may only update safe columns — never role.
-- (Table-level UPDATE is revoked, then column-level UPDATE granted back.)
REVOKE UPDATE ON profiles FROM authenticated, anon;
GRANT UPDATE (full_name, avatar_url, updated_at) ON profiles TO authenticated;

-- Amendment 2: auto-create a profile row on first sign-in / invite.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

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
  icp_raw_input   TEXT,
  icp_params      JSONB,
  sources         TEXT[] DEFAULT ARRAY['google_places'],
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
CREATE POLICY "scrape_jobs_admin" ON scrape_jobs FOR ALL USING (is_admin());

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
  source          TEXT,
  source_id       TEXT,
  raw_data        JSONB,
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','duplicate')),
  duplicate_of    UUID REFERENCES raw_leads(id),
  approved_by     UUID REFERENCES profiles(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE raw_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "raw_leads_own" ON raw_leads FOR ALL USING (
  EXISTS (SELECT 1 FROM scrape_jobs WHERE id = raw_leads.scrape_job_id AND created_by = auth.uid())
);
CREATE POLICY "raw_leads_admin" ON raw_leads FOR ALL USING (is_admin());

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
  kanban_position   INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads_own" ON leads FOR ALL USING (
  auth.uid() = created_by OR auth.uid() = assigned_to
);
CREATE POLICY "leads_admin" ON leads FOR ALL USING (is_admin());

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
  ai_extracted_data  JSONB,
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
CREATE POLICY "notes_admin" ON lead_notes FOR ALL USING (is_admin());

-- ─────────────────────────────────────────
-- EMAIL TEMPLATES
-- ─────────────────────────────────────────
CREATE TABLE email_templates (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  template_type  TEXT DEFAULT 'custom'
                   CHECK (template_type IN (
                     'initial_followup','second_chase','not_now_nurture',
                     'audit_confirmation','proposal_followup','custom'
                   )),
  is_default     BOOLEAN DEFAULT false,
  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "templates_read_all"  ON email_templates FOR SELECT USING (is_default = true OR auth.uid() = created_by);
CREATE POLICY "templates_own_write" ON email_templates FOR ALL USING (auth.uid() = created_by);
CREATE POLICY "templates_admin"     ON email_templates FOR ALL USING (is_admin());

-- ─────────────────────────────────────────
-- EMAIL SEQUENCES
-- ─────────────────────────────────────────
CREATE TABLE email_sequences (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  steps        JSONB NOT NULL DEFAULT '[]',
  is_default   BOOLEAN DEFAULT false,
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sequences_read"  ON email_sequences FOR SELECT USING (is_default = true OR auth.uid() = created_by);
CREATE POLICY "sequences_write" ON email_sequences FOR ALL USING (auth.uid() = created_by);
CREATE POLICY "sequences_admin" ON email_sequences FOR ALL USING (is_admin());

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
CREATE POLICY "enrollments_admin" ON sequence_enrollments FOR ALL USING (is_admin());

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
CREATE POLICY "logs_admin" ON email_logs FOR ALL USING (is_admin());

-- ─────────────────────────────────────────
-- Amendment 4: realtime + indexes
-- ─────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_next_action ON leads(next_action_date);
CREATE INDEX idx_lead_notes_lead ON lead_notes(lead_id);
```

- [ ] **Step 2: HUMAN ACTION (Kevin) — create the Supabase project and run the migration**

1. supabase.com → New project → name `dreamlabs-sales`, region `eu-west-2 (London)`, generate a strong DB password (save it in your password manager).
2. SQL Editor → New query → paste the entire contents of `supabase/migrations/001_initial_schema.sql` → Run. Expected: "Success. No rows returned".
3. Authentication → Users → **Add user** → your email `kevindigitalinflux@gmail.com` + a password (this is your login; the trigger auto-creates your profile).
4. SQL Editor → run: `UPDATE profiles SET role = 'admin', full_name = 'Kevin Zamora-Saenz' WHERE email = 'kevindigitalinflux@gmail.com';` Expected: `UPDATE 1`.
5. Project Settings → API → copy **Project URL** and **anon public** key into `.env` in the project root:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

6. Authentication → URL Configuration → set **Site URL** to `http://localhost:5173` (needed later for invite links).

- [ ] **Step 3: Write the Supabase client**

`src/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — copy .env.example to .env and fill it in.');
}

/** Single shared Supabase client for the whole app. */
export const supabase = createClient(url, anonKey);
```

- [ ] **Step 4: Verify the schema is reachable**

Verify tables exist — in Supabase SQL Editor run: `SELECT count(*) FROM profiles;` Expected: `1` (Kevin's profile).
Local check: `npm run build` exits 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/001_initial_schema.sql src/lib/supabase.ts
git commit -m "feat: initial schema migration with is_admin RLS helper + supabase client"
```

(Confirm `git status` shows `.env` is NOT staged — it must never be.)

---

### Task 3: Shared types + utils (TDD)

**Files:**
- Create: `src/types/index.ts`
- Create: `src/lib/utils.ts`
- Test: `src/lib/utils.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by every later task):
  - Types: `Role`, `Stage`, `PackageTier`, `NoteType`, `Profile`, `Lead`, `LeadNote`
  - `STAGES: StageInfo[]` (ordered, 8 entries: `{ value: Stage; label: string; hex: string }`)
  - `stageInfo(stage: Stage): StageInfo`
  - `PACKAGE_TIERS: { value: PackageTier; label: string }[]` and `packageLabel(tier: PackageTier | null): string`
  - `daysOverdue(dateISO: string, today?: Date): number` — whole days past due, 0 if today/future
  - `isOverdue(dateISO: string | null, today?: Date): boolean`
  - `isDueToday(dateISO: string | null, today?: Date): boolean`
  - `dueLabel(dateISO: string, today?: Date): string` — "2 days overdue" / "Due today" / "Due tomorrow" / "Due in 3 days"
  - `formatShortDate(iso: string): string` — "12 Jul 2026"
  - `formatCurrency(value: number): string` — "£1,200"
  - `initials(name: string | null | undefined): string` — "Eszter Kovacs" → "EK"

- [ ] **Step 1: Write `src/types/index.ts`**

```ts
export type Role = 'admin' | 'contractor';

export type Stage =
  | 'new_lead' | 'contacted' | 'audit_booked' | 'proposal_sent'
  | 'negotiating' | 'won' | 'lost' | 'not_now_nurture';

export type PackageTier =
  | 'pilot_systems' | 'pilot_ai_app' | 'pilot_full_build'
  | 'automation_sprint' | 'ai_foundation' | 'full_build'
  | 'retainer_bronze' | 'retainer_silver' | 'retainer_gold' | 'custom';

export type NoteType = 'call' | 'email' | 'meeting' | 'general' | 'ai_summary';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  business_name: string;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  postcode: string | null;
  google_rating: number | null;
  review_count: number | null;
  vertical: string | null;
  stage: Stage;
  package_tier: PackageTier | null;
  deal_value: number | null;
  assigned_to: string | null;
  created_by: string | null;
  raw_lead_id: string | null;
  next_action_date: string | null;
  next_action_note: string | null;
  call_count: number;
  last_contacted_at: string | null;
  kanban_position: number;
  created_at: string;
  updated_at: string;
}

export interface LeadNote {
  id: string;
  lead_id: string;
  created_by: string | null;
  content: string;
  note_type: NoteType;
  ai_extracted_data: unknown;
  created_at: string;
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  STAGES, stageInfo, PACKAGE_TIERS, packageLabel,
  daysOverdue, isOverdue, isDueToday, dueLabel,
  formatShortDate, formatCurrency, initials,
} from './utils';

const TODAY = new Date(2026, 6, 12); // 12 Jul 2026 (local)

describe('stages', () => {
  it('has all 8 pipeline stages in spec order', () => {
    expect(STAGES.map((s) => s.value)).toEqual([
      'new_lead', 'contacted', 'audit_booked', 'proposal_sent',
      'negotiating', 'won', 'lost', 'not_now_nurture',
    ]);
  });
  it('has unique hex colours', () => {
    expect(new Set(STAGES.map((s) => s.hex)).size).toBe(8);
  });
  it('stageInfo returns the right entry', () => {
    expect(stageInfo('won')).toEqual({ value: 'won', label: 'Won', hex: '#22C55E' });
  });
});

describe('package tiers', () => {
  it('has all 10 tiers', () => {
    expect(PACKAGE_TIERS).toHaveLength(10);
  });
  it('packageLabel handles null', () => {
    expect(packageLabel(null)).toBe('—');
    expect(packageLabel('retainer_gold')).toBe('Retainer — Gold');
  });
});

describe('overdue logic', () => {
  it('daysOverdue is 0 for today and future dates', () => {
    expect(daysOverdue('2026-07-12', TODAY)).toBe(0);
    expect(daysOverdue('2026-07-20', TODAY)).toBe(0);
  });
  it('daysOverdue counts whole days past due', () => {
    expect(daysOverdue('2026-07-10', TODAY)).toBe(2);
    expect(daysOverdue('2026-07-11', TODAY)).toBe(1);
  });
  it('isOverdue: past yes, today no, null no', () => {
    expect(isOverdue('2026-07-10', TODAY)).toBe(true);
    expect(isOverdue('2026-07-12', TODAY)).toBe(false);
    expect(isOverdue(null, TODAY)).toBe(false);
  });
  it('isDueToday', () => {
    expect(isDueToday('2026-07-12', TODAY)).toBe(true);
    expect(isDueToday('2026-07-11', TODAY)).toBe(false);
    expect(isDueToday(null, TODAY)).toBe(false);
  });
  it('dueLabel variants', () => {
    expect(dueLabel('2026-07-10', TODAY)).toBe('2 days overdue');
    expect(dueLabel('2026-07-11', TODAY)).toBe('1 day overdue');
    expect(dueLabel('2026-07-12', TODAY)).toBe('Due today');
    expect(dueLabel('2026-07-13', TODAY)).toBe('Due tomorrow');
    expect(dueLabel('2026-07-15', TODAY)).toBe('Due in 3 days');
  });
});

describe('formatting', () => {
  it('formatShortDate', () => {
    expect(formatShortDate('2026-07-12')).toBe('12 Jul 2026');
  });
  it('formatCurrency uses GBP with no decimals', () => {
    expect(formatCurrency(1200)).toBe('£1,200');
  });
  it('initials', () => {
    expect(initials('Eszter Kovacs')).toBe('EK');
    expect(initials('Kevin')).toBe('K');
    expect(initials(null)).toBe('?');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './utils'` (or equivalent resolution error).

- [ ] **Step 4: Write `src/lib/utils.ts`**

```ts
import type { PackageTier, Stage } from '../types';

export interface StageInfo {
  value: Stage;
  label: string;
  hex: string;
}

/** All pipeline stages in spec order with their brand colours (SPEC.md §6). */
export const STAGES: StageInfo[] = [
  { value: 'new_lead', label: 'New Lead', hex: '#94A3B8' },
  { value: 'contacted', label: 'Contacted', hex: '#8B32FF' },
  { value: 'audit_booked', label: 'Audit Booked', hex: '#00DFDF' },
  { value: 'proposal_sent', label: 'Proposal Sent', hex: '#F59E0B' },
  { value: 'negotiating', label: 'Negotiating', hex: '#F97316' },
  { value: 'won', label: 'Won', hex: '#22C55E' },
  { value: 'lost', label: 'Lost', hex: '#EF4444' },
  { value: 'not_now_nurture', label: 'Not Now / Nurture', hex: '#64378B' },
];

/** Looks up the StageInfo for a stage value. Throws on unknown stages. */
export function stageInfo(stage: Stage): StageInfo {
  const info = STAGES.find((s) => s.value === stage);
  if (!info) throw new Error(`Unknown stage: ${stage as string}`);
  return info;
}

/** All package tiers with display labels (SPEC.md §3 leads.package_tier). */
export const PACKAGE_TIERS: { value: PackageTier; label: string }[] = [
  { value: 'pilot_systems', label: 'Pilot — Systems' },
  { value: 'pilot_ai_app', label: 'Pilot — AI App' },
  { value: 'pilot_full_build', label: 'Pilot — Full Build' },
  { value: 'automation_sprint', label: 'Automation Sprint' },
  { value: 'ai_foundation', label: 'AI Foundation' },
  { value: 'full_build', label: 'Full Build' },
  { value: 'retainer_bronze', label: 'Retainer — Bronze' },
  { value: 'retainer_silver', label: 'Retainer — Silver' },
  { value: 'retainer_gold', label: 'Retainer — Gold' },
  { value: 'custom', label: 'Custom' },
];

/** Display label for a package tier; em dash for none. */
export function packageLabel(tier: PackageTier | null): string {
  if (!tier) return '—';
  return PACKAGE_TIERS.find((t) => t.value === tier)?.label ?? tier;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parses a DATE column value ('YYYY-MM-DD') as a local date, not UTC. */
function parseDateOnly(dateISO: string): Date {
  const [y, m, d] = dateISO.slice(0, 10).split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

const MS_PER_DAY = 86_400_000;

/** Whole days a date is past due; 0 if due today or in the future. */
export function daysOverdue(dateISO: string, today: Date = new Date()): number {
  const diff = (startOfDay(today).getTime() - parseDateOnly(dateISO).getTime()) / MS_PER_DAY;
  return Math.max(0, Math.round(diff));
}

/** True when the date is strictly before today. */
export function isOverdue(dateISO: string | null, today: Date = new Date()): boolean {
  return dateISO !== null && daysOverdue(dateISO, today) > 0;
}

/** True when the date is exactly today. */
export function isDueToday(dateISO: string | null, today: Date = new Date()): boolean {
  if (dateISO === null) return false;
  return parseDateOnly(dateISO).getTime() === startOfDay(today).getTime();
}

/** Human label for a next-action date: "2 days overdue" | "Due today" | "Due tomorrow" | "Due in N days". */
export function dueLabel(dateISO: string, today: Date = new Date()): string {
  const overdue = daysOverdue(dateISO, today);
  if (overdue === 1) return '1 day overdue';
  if (overdue > 1) return `${overdue} days overdue`;
  if (isDueToday(dateISO, today)) return 'Due today';
  const inDays = Math.round((parseDateOnly(dateISO).getTime() - startOfDay(today).getTime()) / MS_PER_DAY);
  return inDays === 1 ? 'Due tomorrow' : `Due in ${inDays} days`;
}

/** "12 Jul 2026" — UK short date for any ISO date or timestamp string. */
export function formatShortDate(iso: string): string {
  const d = iso.length <= 10 ? parseDateOnly(iso) : new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole-pound GBP: 1200 → "£1,200". */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
  }).format(value);
}

/** Up-to-two-letter initials for avatar chips; "?" when no name. */
export function initials(name: string | null | undefined): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat: shared types, stage/package maps, date + formatting utils with tests"
```

---

### Task 4: UI primitives (design system base)

**Files:**
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Input.tsx`
- Create: `src/components/ui/Badge.tsx`
- Create: `src/components/ui/Card.tsx`
- Create: `src/components/ui/Modal.tsx`
- Create: `src/components/ui/Skeleton.tsx`
- Create: `src/components/ui/EmptyState.tsx`
- Create: `src/components/ui/StepProgress.tsx`

**Interfaces:**
- Consumes: theme classes from Task 1.
- Produces (exact signatures later tasks import):
  - `Button({ variant?: 'primary'|'secondary'|'ghost'|'danger', ...ButtonHTMLAttributes })`
  - `Input({ label: string, error?: string, ...InputHTMLAttributes })`
  - `Textarea({ label: string, error?: string, ...TextareaHTMLAttributes })` (exported from `Input.tsx`)
  - `SelectField({ label: string, children, ...SelectHTMLAttributes })` (exported from `Input.tsx`)
  - `Badge({ className?, children })`
  - `Card({ className?, children })`
  - `Modal({ open: boolean, onClose: () => void, title: string, children })`
  - `Skeleton({ className? })`
  - `EmptyState({ icon: LucideIcon, title: string, hint?: string, action?: ReactNode })`
  - `StepProgress({ step: number, total: number })` — "Step X of N" + bar

All interactive elements are `min-h-11` (44px floor). No spinners anywhere — `Skeleton` blocks only.

- [ ] **Step 1: Write Button and Input (+Textarea, SelectField)**

`src/components/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-violet text-offwhite hover:bg-violet/85',
  secondary: 'border border-line bg-surface text-offwhite hover:bg-surface/70',
  ghost: 'bg-transparent text-muted hover:bg-surface/60 hover:text-offwhite',
  danger: 'border border-red-500/40 bg-red-500/15 text-red-400 hover:bg-red-500/25',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/** 44px-minimum button in the four app variants. Defaults to type="button". */
export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-[15px] font-semibold transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
}
```

`src/components/ui/Input.tsx`:

```tsx
import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const FIELD_CLASSES =
  'w-full rounded-lg border border-line bg-surface px-3 text-base text-offwhite outline-none placeholder:text-muted focus:border-cyan';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

/** Labelled text input, 44px tall, cyan focus ring. */
export function Input({ label, error, className = '', ...rest }: InputProps) {
  const id = useId();
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted">{label}</label>
      <input id={id} className={`min-h-11 ${FIELD_CLASSES} ${className}`} {...rest} />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

/** Labelled textarea — 18px font so iOS never auto-zooms (SPEC.md §12). */
export function Textarea({ label, error, className = '', ...rest }: TextareaProps) {
  const id = useId();
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted">{label}</label>
      <textarea id={id} className={`min-h-28 py-2 text-[18px] ${FIELD_CLASSES} ${className}`} {...rest} />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  children: ReactNode;
}

/** Labelled native select, 44px tall. */
export function SelectField({ label, children, className = '', ...rest }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted">{label}</label>
      <select id={id} className={`min-h-11 ${FIELD_CLASSES} ${className}`} {...rest}>
        {children}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Write Badge, Card, Skeleton, EmptyState, StepProgress**

`src/components/ui/Badge.tsx`:

```tsx
import type { ReactNode } from 'react';

/** Small pill label. Colour comes from className (e.g. stage classes). */
export function Badge({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}
```

`src/components/ui/Card.tsx`:

```tsx
import type { ReactNode } from 'react';

/** Elevated card surface on the navy background. */
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border border-line bg-card p-4 ${className}`}>{children}</div>;
}
```

`src/components/ui/Skeleton.tsx`:

```tsx
/** Shimmer placeholder block — the app's only loading indicator (no spinners). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`rounded-md bg-surface motion-safe:animate-pulse ${className}`} />;
}
```

`src/components/ui/EmptyState.tsx`:

```tsx
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
}

/** Friendly empty state: icon + title + optional hint + optional action button. */
export function EmptyState({ icon: Icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line p-10 text-center">
      <Icon className="h-8 w-8 text-muted" aria-hidden />
      <p className="font-heading text-lg font-bold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
```

`src/components/ui/StepProgress.tsx`:

```tsx
/** "Step X of N" indicator with a progress bar — required on every multi-step flow. */
export function StepProgress({ step, total }: { step: number; total: number }) {
  const widthClass = ['w-1/6', 'w-2/6', 'w-3/6', 'w-4/6', 'w-5/6', 'w-full'];
  const fraction = Math.min(5, Math.max(0, Math.round((step / total) * 6) - 1));
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-muted">Step {step} of {total}</p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div className={`h-full rounded-full bg-cyan transition-all motion-reduce:transition-none ${widthClass[fraction]}`} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write Modal**

`src/components/ui/Modal.tsx`:

```tsx
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/** Centered dialog. Closes on Escape, overlay click, or the X button. */
export function Modal({ open, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-offwhite"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: exits 0. (These are verified visually in Task 5 when Login uses them.)

- [ ] **Step 5: Commit**

```bash
git add src/components/ui
git commit -m "feat: UI primitives - Button, Input, Badge, Card, Modal, Skeleton, EmptyState, StepProgress"
```

---

### Task 5: Auth — provider, login page, route guards

**Files:**
- Create: `src/hooks/useAuth.tsx`
- Create: `src/pages/Login.tsx`
- Create: `src/components/layout/ProtectedRoute.tsx`
- Modify: `src/App.tsx` (replace smoke-test content)

**Interfaces:**
- Consumes: `supabase` (Task 2), `Profile` type (Task 3), `Button`/`Input` (Task 4).
- Produces:
  - `AuthProvider({ children })` and `useAuth(): { session: Session | null; profile: Profile | null; loading: boolean; signIn(email: string, password: string): Promise<string | null>; signOut(): Promise<void> }` — `signIn` resolves to an error message or `null` on success.
  - `ProtectedRoute()` / `AdminRoute()` — react-router layout routes rendering `<Outlet />`.

- [ ] **Step 1: Write `src/hooks/useAuth.tsx`**

```tsx
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Provides Supabase session + the signed-in user's profile (with role) to the app. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) {
          setProfile((data as Profile | null) ?? null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  /** Signs in with email/password; returns an error message or null on success. */
  async function signIn(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }

  /** Signs the current user out. */
  async function signOut(): Promise<void> {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Access the auth context; must be used inside AuthProvider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Write `src/components/layout/ProtectedRoute.tsx`**

```tsx
import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { Skeleton } from '../ui/Skeleton';

/** Blocks unauthenticated users; renders child routes once a session exists. */
export function ProtectedRoute() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-24 w-72" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Blocks non-admins (UX only — RLS is the real boundary). */
export function AdminRoute() {
  const { profile, loading } = useAuth();
  if (loading) return null;
  if (profile?.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
```

- [ ] **Step 3: Write `src/pages/Login.tsx`**

```tsx
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

/** Email + password sign-in. No self-registration — accounts are invite-only. */
export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const err = await signIn(email, password);
    setSubmitting(false);
    if (err) setError(err);
    else navigate('/', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border border-line bg-card p-8">
        <h1 className="mb-1 text-[28px] font-extrabold">
          Dreamlabs<span className="text-cyan">Sales</span>
        </h1>
        <p className="mb-6 text-sm text-muted">Sign in to your workspace</p>
        <div className="flex flex-col gap-4">
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Replace `src/App.tsx` with a minimal guarded router**

```tsx
import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { Login } from './pages/Login';

function Home() {
  const { profile, signOut } = useAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <h1 className="text-[22px] font-bold">Signed in as {profile?.full_name ?? profile?.email}</h1>
      <p className="text-muted">Role: {profile?.role}</p>
      <button type="button" onClick={() => void signOut()} className="min-h-11 cursor-pointer rounded-lg bg-surface px-4 font-semibold">
        Sign out
      </button>
    </div>
  );
}

/** App root: router + auth provider. Full route tree arrives in Task 6. */
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Home />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 5: Verify auth in the browser**

Run: `npm run dev`

1. Open http://localhost:5173 → redirected to `/login`.
2. Sign in with a wrong password → inline red error appears, no crash.
3. Sign in with Kevin's real credentials (from Task 2 Step 2.3) → home shows "Signed in as Kevin Zamora-Saenz", "Role: admin".
4. Refresh the page → still signed in (session persistence).
5. Click Sign out → back to `/login`.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAuth.tsx src/pages/Login.tsx src/components/layout/ProtectedRoute.tsx src/App.tsx
git commit -m "feat: supabase auth - provider, login page, protected + admin routes"
```

---

### Task 6: App shell, navigation, full route skeleton

**Files:**
- Create: `src/components/layout/AppShell.tsx`
- Create: `src/components/layout/Sidebar.tsx`
- Create: `src/components/layout/TopBar.tsx`
- Create: `src/components/layout/MobileNav.tsx`
- Create: `src/components/layout/ComingSoon.tsx`
- Create: `src/pages/Dashboard.tsx` (stub — real content Task 15)
- Create: `src/pages/PipelineKanban.tsx` (stub — real content Task 10)
- Create: `src/pages/PipelineList.tsx` (stub — real content Task 12)
- Create: `src/pages/LeadDetailPage.tsx` (stub — real content Task 13)
- Create: `src/pages/Settings.tsx`
- Create: `src/pages/Admin.tsx` (stub — real content Task 7)
- Create: `src/pages/PipelineRedirect.tsx`
- Modify: `src/App.tsx` (full route tree)

**Interfaces:**
- Consumes: `useAuth`, `ProtectedRoute`/`AdminRoute`, UI primitives.
- Produces: `AppShell()` layout route with `<Outlet />`; route paths per SPEC.md §13; localStorage key `pipeline-view` (`'kanban' | 'list'`) read by `PipelineRedirect`, written by the pipeline pages' `ViewToggle` (Task 10).

- [ ] **Step 1: Write Sidebar**

`src/components/layout/Sidebar.tsx`:

```tsx
import { NavLink } from 'react-router';
import { BarChart3, KanbanSquare, LayoutDashboard, Mail, Radar, Settings, Shield } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { to: '/scraper', label: 'Scraper', icon: Radar },
  { to: '/emails', label: 'Emails', icon: Mail },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return `flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-semibold transition-colors motion-reduce:transition-none ${
    isActive ? 'bg-violet/20 text-offwhite' : 'text-muted hover:bg-surface hover:text-offwhite'
  }`;
}

/** Desktop sidebar navigation. Hidden below md; MobileNav takes over there. */
export function Sidebar() {
  const { profile } = useAuth();
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-navy/40 p-4 md:flex">
      <p className="mb-8 px-2 font-heading text-lg font-extrabold">
        Dreamlabs<span className="text-cyan">Sales</span>
      </p>
      <nav className="flex flex-col gap-1" aria-label="Main">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={navClass}>
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </NavLink>
        ))}
        {profile?.role === 'admin' && (
          <NavLink to="/admin" className={navClass}>
            <Shield className="h-5 w-5" aria-hidden />
            Admin
          </NavLink>
        )}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Write TopBar and MobileNav**

`src/components/layout/TopBar.tsx`:

```tsx
import { LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { initials } from '../../lib/utils';

/** Top bar: user identity + sign out. Focus-mode toggle is added in Task 16. */
export function TopBar() {
  const { profile, signOut } = useAuth();
  return (
    <header className="flex min-h-14 items-center justify-end gap-3 border-b border-line px-4">
      <span
        aria-hidden
        className="flex h-8 w-8 items-center justify-center rounded-full bg-purple text-xs font-bold"
      >
        {initials(profile?.full_name)}
      </span>
      <span className="hidden text-sm font-semibold sm:block">{profile?.full_name ?? profile?.email}</span>
      <button
        type="button"
        onClick={() => void signOut()}
        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-surface hover:text-offwhite"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        Sign out
      </button>
    </header>
  );
}
```

`src/components/layout/MobileNav.tsx`:

```tsx
import { NavLink } from 'react-router';
import { KanbanSquare, LayoutDashboard, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ITEMS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Today', icon: LayoutDashboard, end: true },
  { to: '/pipeline/list', label: 'Pipeline', icon: KanbanSquare },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/** Bottom tab bar for mobile (spec: mobile is note-taking first — Dashboard, List, Settings). */
export function MobileNav() {
  return (
    <nav
      aria-label="Mobile"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-navy/95 backdrop-blur md:hidden"
    >
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
              isActive ? 'text-cyan' : 'text-muted'
            }`
          }
        >
          <Icon className="h-5 w-5" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Write AppShell and ComingSoon**

`src/components/layout/AppShell.tsx`:

```tsx
import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileNav } from './MobileNav';

/** Main authenticated layout: sidebar (desktop) + topbar + content + mobile tab bar. */
export function AppShell() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 p-4 pb-20 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
```

`src/components/layout/ComingSoon.tsx`:

```tsx
import { Hourglass } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

/** Placeholder page for modules that arrive in later build cycles. */
export function ComingSoon({ module }: { module: string }) {
  return (
    <div className="mx-auto max-w-2xl pt-16">
      <EmptyState
        icon={Hourglass}
        title={`${module} is coming soon`}
        hint="This module arrives in a later build cycle. The database is already ready for it."
      />
    </div>
  );
}
```

- [ ] **Step 4: Write page stubs, Settings, and PipelineRedirect**

`src/pages/Dashboard.tsx` (stub):

```tsx
/** Today's Focus dashboard — placeholder until Task 15. */
export function Dashboard() {
  return <h1 className="text-[28px] font-extrabold">Dashboard</h1>;
}
```

`src/pages/PipelineKanban.tsx` (stub):

```tsx
/** Kanban pipeline view — placeholder until Task 10. */
export function PipelineKanban() {
  return <h1 className="text-[28px] font-extrabold">Pipeline — Kanban</h1>;
}
```

`src/pages/PipelineList.tsx` (stub):

```tsx
/** List pipeline view — placeholder until Task 12. */
export function PipelineList() {
  return <h1 className="text-[28px] font-extrabold">Pipeline — List</h1>;
}
```

`src/pages/LeadDetailPage.tsx` (stub):

```tsx
import { useParams } from 'react-router';

/** Full lead record — placeholder until Task 13. */
export function LeadDetailPage() {
  const { id } = useParams();
  return <h1 className="text-[28px] font-extrabold">Lead {id}</h1>;
}
```

`src/pages/Admin.tsx` (stub):

```tsx
/** Admin panel — placeholder until Task 7. */
export function Admin() {
  return <h1 className="text-[28px] font-extrabold">Admin</h1>;
}
```

`src/pages/PipelineRedirect.tsx`:

```tsx
import { Navigate } from 'react-router';

/** /pipeline → the user's last-used view (kanban default), persisted in localStorage. */
export function PipelineRedirect() {
  const view = localStorage.getItem('pipeline-view') === 'list' ? 'list' : 'kanban';
  return <Navigate to={`/pipeline/${view}`} replace />;
}
```

`src/pages/Settings.tsx` (real — it's small):

```tsx
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';

/** Profile settings: display name. Email SMTP config arrives in cycle 2. */
export function Settings() {
  const { profile } = useAuth();
  const [fullName, setFullName] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setFullName(profile?.full_name ?? '');
  }, [profile]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setStatus('saving');
    const { error } = await supabase.from('profiles').update({ full_name: fullName }).eq('id', profile.id);
    setStatus(error ? 'error' : 'saved');
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-[28px] font-extrabold">Settings</h1>
      <Card>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <h2 className="text-[18px] font-bold">Profile</h2>
          <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
            {status === 'saved' && <span className="text-sm text-green-400">Saved ✓</span>}
            {status === 'error' && <span role="alert" className="text-sm text-red-400">Could not save — try again.</span>}
          </div>
        </form>
      </Card>
      <Card>
        <h2 className="mb-1 text-[18px] font-bold">Email sending</h2>
        <p className="text-sm text-muted">SMTP configuration arrives with the Email Automation module in the next build cycle.</p>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Replace `src/App.tsx` with the full route tree**

```tsx
import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider } from './hooks/useAuth';
import { AdminRoute, ProtectedRoute } from './components/layout/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { ComingSoon } from './components/layout/ComingSoon';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { PipelineRedirect } from './pages/PipelineRedirect';
import { PipelineKanban } from './pages/PipelineKanban';
import { PipelineList } from './pages/PipelineList';
import { LeadDetailPage } from './pages/LeadDetailPage';
import { Settings } from './pages/Settings';
import { Admin } from './pages/Admin';

/** App root: full SPEC.md §13 route tree (later-cycle modules render ComingSoon). */
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/pipeline" element={<PipelineRedirect />} />
              <Route path="/pipeline/kanban" element={<PipelineKanban />} />
              <Route path="/pipeline/list" element={<PipelineList />} />
              <Route path="/pipeline/leads/:id" element={<LeadDetailPage />} />
              <Route path="/scraper/*" element={<ComingSoon module="Lead Scraper" />} />
              <Route path="/emails/*" element={<ComingSoon module="Email Automation" />} />
              <Route path="/analytics" element={<ComingSoon module="Analytics" />} />
              <Route path="/settings" element={<Settings />} />
              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<Admin />} />
              </Route>
              <Route path="*" element={<ComingSoon module="This page" />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 6: Verify in browser**

Run: `npm run dev`

1. Sign in → sidebar shows Dashboard/Pipeline/Scraper/Emails/Analytics/Settings **and Admin** (Kevin is admin).
2. `/pipeline` redirects to `/pipeline/kanban`.
3. `/scraper` shows the ComingSoon empty state.
4. Settings → edit full name → Save → "Saved ✓"; refresh → name persists (top bar shows it).
5. Narrow the window below 768px → sidebar disappears, bottom tab bar appears with Today/Pipeline/Settings.
6. Navigate directly to `/admin` → renders (admin). (Contractor check happens in Task 17's RLS verification.)

- [ ] **Step 7: Commit**

```bash
git add src/components/layout src/pages src/App.tsx
git commit -m "feat: app shell, sidebar + mobile nav, full route skeleton, settings page"
```

---

### Task 7: Admin — `admin-users` Edge Function, invite flow, user management page

**Files:**
- Create: `supabase/functions/admin-users/index.ts`
- Create: `src/hooks/useProfiles.ts`
- Create: `src/pages/Welcome.tsx`
- Create: `src/components/admin/UserTable.tsx`
- Create: `src/components/admin/InviteModal.tsx`
- Create: `src/components/admin/AssignmentPanel.tsx`
- Modify: `src/pages/Admin.tsx` (replace stub)
- Modify: `src/App.tsx` (add `/welcome` route)

**Interfaces:**
- Consumes: `supabase`, `useAuth`, `Profile`/`Role`/`Lead` types, UI primitives.
- Produces:
  - Edge Function `admin-users` accepting POST JSON: `{ action: 'invite', email: string, full_name: string, redirect_to: string }` or `{ action: 'set_role', user_id: string, role: 'admin' | 'contractor' }`. Responds `{ ok: true }` or `{ error: string }`. Caller must be a signed-in admin.
  - `useProfiles(): { profiles: Profile[]; loading: boolean; error: string | null; refresh(): Promise<void> }` — RLS-scoped (admins see all; contractors see only themselves). Reused by Tasks 9, 11, 12, 13.

**Security notes (non-negotiable):** the service-role key exists ONLY as an Edge Function secret. The function verifies the caller's JWT AND that the caller's profile role is `admin` before doing anything. CORS is restricted to the origins in the `APP_ORIGINS` secret — never `*`.

- [ ] **Step 1: Write the Edge Function**

`supabase/functions/admin-users/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? 'http://localhost:5173').split(',');

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && APP_ORIGINS.includes(origin) ? origin : APP_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  // 1. Identify the caller from their JWT.
  const authHeader = req.headers.get('Authorization') ?? '';
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await anonClient.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401, headers);

  // 2. Verify the caller is an admin (service client bypasses RLS for this check).
  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: caller } = await service
    .from('profiles').select('role').eq('id', userData.user.id).single();
  if (caller?.role !== 'admin') return json({ error: 'Admin only' }, 403, headers);

  // 3. Perform the action.
  const body = (await req.json()) as Record<string, unknown>;

  if (body.action === 'invite') {
    const email = String(body.email ?? '');
    const fullName = String(body.full_name ?? '');
    const redirectTo = String(body.redirect_to ?? '');
    if (!email) return json({ error: 'email is required' }, 400, headers);
    if (!APP_ORIGINS.some((o) => redirectTo.startsWith(o))) {
      return json({ error: 'redirect_to not allowed' }, 400, headers);
    }
    const { error } = await service.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo,
    });
    if (error) return json({ error: error.message }, 400, headers);
    return json({ ok: true }, 200, headers);
  }

  if (body.action === 'set_role') {
    const userId = String(body.user_id ?? '');
    const role = String(body.role ?? '');
    if (role !== 'admin' && role !== 'contractor') return json({ error: 'Invalid role' }, 400, headers);
    if (userId === userData.user.id) return json({ error: 'You cannot change your own role' }, 400, headers);
    const { error } = await service.from('profiles').update({ role }).eq('id', userId);
    if (error) return json({ error: error.message }, 400, headers);
    return json({ ok: true }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
```

- [ ] **Step 2: Deploy the Edge Function**

```bash
cd /c/Users/kevin/Projects/dreamlabs-sales
npx supabase login          # HUMAN ACTION (Kevin): completes browser auth
npx supabase link --project-ref <project-ref>   # ref from the Supabase project URL
npx supabase secrets set APP_ORIGINS=http://localhost:5173
npx supabase functions deploy admin-users
```

Expected: "Deployed Function admin-users".

**HUMAN ACTION (Kevin):** Supabase Dashboard → Authentication → URL Configuration → add `http://localhost:5173/welcome` to **Redirect URLs**.

- [ ] **Step 3: Write `src/hooks/useProfiles.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

/** All profiles visible to the current user (RLS: admins see everyone, contractors see themselves). */
export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase.from('profiles').select('*').order('created_at');
    if (err) setError(err.message);
    else {
      setProfiles(data as Profile[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profiles, loading, error, refresh };
}
```

- [ ] **Step 4: Write the Welcome (invite acceptance) page and route**

`src/pages/Welcome.tsx`:

```tsx
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

/** Landing page for invite links: the invitee sets their password here. */
export function Welcome() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setSubmitting(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (err) setError(err.message);
    else navigate('/', { replace: true });
  }

  if (loading) return null;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border border-line bg-card p-8">
        <h1 className="mb-1 text-[22px] font-bold">Welcome to Dreamlabs Sales</h1>
        {session ? (
          <>
            <p className="mb-6 text-sm text-muted">Set a password to finish creating your account.</p>
            <div className="flex flex-col gap-4">
              <Input label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
              <Input label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
              {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? 'Saving…' : 'Set password & enter'}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">
            This page is for invite links. Open the link from your invitation email again — if it has expired, ask Kevin to re-invite you.
          </p>
        )}
      </form>
    </div>
  );
}
```

In `src/App.tsx`, add the import `import { Welcome } from './pages/Welcome';` and this route next to `/login` (public — outside `ProtectedRoute`):

```tsx
<Route path="/welcome" element={<Welcome />} />
```

- [ ] **Step 5: Write the Admin page components**

`src/components/admin/InviteModal.tsx`:

```tsx
import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  onInvited: () => void;
}

/** Sends a contractor invite via the admin-users Edge Function. */
export function InviteModal({ open, onClose, onInvited }: InviteModalProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('admin-users', {
      body: {
        action: 'invite',
        email,
        full_name: fullName,
        redirect_to: `${window.location.origin}/welcome`,
      },
    });
    setSubmitting(false);
    const apiError = err?.message ?? (data as { error?: string } | null)?.error;
    if (apiError) return setError(apiError);
    setFullName('');
    setEmail('');
    onInvited();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite contractor">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send invite'}
        </Button>
      </form>
    </Modal>
  );
}
```

`src/components/admin/UserTable.tsx`:

```tsx
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Profile, Role } from '../../types';
import { formatShortDate } from '../../lib/utils';
import { useAuth } from '../../hooks/useAuth';

interface UserTableProps {
  users: Profile[];
  onChanged: () => void;
}

/** Admin user list with per-row role editing (via the admin-users Edge Function). */
export function UserTable({ users, onChanged }: UserTableProps) {
  const { profile: me } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setRole(userId: string, role: Role) {
    setBusyId(userId);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('admin-users', {
      body: { action: 'set_role', user_id: userId, role },
    });
    setBusyId(null);
    const apiError = err?.message ?? (data as { error?: string } | null)?.error;
    if (apiError) setError(apiError);
    else onChanged();
  }

  return (
    <div className="overflow-x-auto">
      {error && <p role="alert" className="mb-2 text-sm text-red-400">{error}</p>}
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs font-semibold text-muted">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-line">
              <td className="px-3 py-3 font-semibold">{u.full_name ?? '—'}</td>
              <td className="px-3 py-3 text-muted">{u.email}</td>
              <td className="px-3 py-3">
                <select
                  aria-label={`Role for ${u.email}`}
                  className="min-h-11 rounded-lg border border-line bg-surface px-2"
                  value={u.role}
                  disabled={u.id === me?.id || busyId === u.id}
                  onChange={(e) => void setRole(u.id, e.target.value as Role)}
                >
                  <option value="contractor">Contractor</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td className="px-3 py-3 text-muted">{formatShortDate(u.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`src/components/admin/AssignmentPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Lead, Profile } from '../../types';
import { Button } from '../ui/Button';
import { SelectField } from '../ui/Input';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';

/** Bulk-assign unassigned leads to a contractor (SPEC.md §10). */
export function AssignmentPanel({ profiles }: { profiles: Profile[] }) {
  const [unassigned, setUnassigned] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignee, setAssignee] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('leads').select('*').is('assigned_to', null).order('created_at');
    if (err) setError(err.message);
    else setUnassigned(data as Lead[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function assign() {
    if (!assignee || selected.size === 0) return;
    const { error: err } = await supabase
      .from('leads').update({ assigned_to: assignee }).in('id', [...selected]);
    if (err) setError(err.message);
    else {
      setSelected(new Set());
      await load();
    }
  }

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) return <p role="alert" className="text-sm text-red-400">{error}</p>;
  if (unassigned.length === 0) {
    return <EmptyState icon={UserCheck} title="No unassigned leads" hint="Every lead in the pipeline has an owner." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {unassigned.map((lead) => (
          <li key={lead.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-surface">
              <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggle(lead.id)} className="h-5 w-5 accent-violet-500" />
              <span className="font-semibold">{lead.business_name}</span>
              <span className="text-sm text-muted">{lead.city ?? ''}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-3">
        <SelectField label="Assign selected to" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Choose contractor…</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
          ))}
        </SelectField>
        <Button onClick={() => void assign()} disabled={!assignee || selected.size === 0}>
          Assign {selected.size > 0 ? `(${selected.size})` : ''}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Replace `src/pages/Admin.tsx`**

```tsx
import { useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { useProfiles } from '../hooks/useProfiles';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { UserTable } from '../components/admin/UserTable';
import { InviteModal } from '../components/admin/InviteModal';
import { AssignmentPanel } from '../components/admin/AssignmentPanel';

/** Admin panel: user management + lead assignment (SPEC.md §10). */
export function Admin() {
  const { profiles, loading, error, refresh } = useProfiles();
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-extrabold">Admin</h1>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4" aria-hidden />
          Invite contractor
        </Button>
      </div>

      <Card>
        <h2 className="mb-3 text-[18px] font-bold">Users</h2>
        {loading && <Skeleton className="h-40 w-full" />}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {!loading && !error && profiles.length === 0 && (
          <EmptyState icon={Users} title="No users yet" hint="Invite your first contractor to get started." />
        )}
        {!loading && !error && profiles.length > 0 && <UserTable users={profiles} onChanged={() => void refresh()} />}
      </Card>

      <Card>
        <h2 className="mb-3 text-[18px] font-bold">Lead assignment</h2>
        <AssignmentPanel profiles={profiles.filter((p) => p.role === 'contractor')} />
      </Card>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={() => void refresh()} />
    </div>
  );
}
```

- [ ] **Step 7: Verify in browser**

1. Sign in as Kevin → `/admin` → your own row shows with the role select disabled.
2. Invite a test contractor using an email you control (e.g. a Gmail +alias like `kevindigitalinflux+eszter@gmail.com`).
3. Open the invite email → link lands on `/welcome` → set a password → you land on `/` signed in as the contractor; sidebar shows NO Admin item.
4. Back as Kevin: the new user appears in the table with role `contractor`.
5. "Lead assignment" shows the no-unassigned-leads empty state (no leads exist yet).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/admin-users src/hooks/useProfiles.ts src/pages/Welcome.tsx src/pages/Admin.tsx src/components/admin src/App.tsx
git commit -m "feat: admin panel - edge function for invite/role, welcome page, user table, assignment"
```

---

### Task 8: Lead data layer + Add Lead wizard

**Files:**
- Create: `src/lib/leadUpdates.ts`
- Create: `src/hooks/useLeads.ts`
- Create: `src/hooks/useLead.ts`
- Create: `src/components/pipeline/AddLeadWizard.tsx`
- Modify: `src/pages/PipelineKanban.tsx`, `src/pages/PipelineList.tsx` (stubs gain an "Add lead" button so the wizard is testable now)

**Interfaces:**
- Consumes: `supabase`, `useAuth`, types, utils, UI primitives (incl. `StepProgress`, `SelectField`).
- Produces:
  - `LeadPatch = Partial<Omit<Lead, 'id' | 'created_at' | 'updated_at' | 'created_by'>>`
  - `applyLeadUpdate(id: string, patch: LeadPatch, before: Lead | null, userId?: string): Promise<string | null>` — updates the row AND auto-logs stage changes to `lead_notes` (content `` `Stage changed: Old → New` ``, type `general`). Every stage mutation in the app MUST go through this.
  - `LeadInput` (all creatable fields, `business_name` required)
  - `useLeads(): { leads: Lead[]; loading: boolean; error: string | null; refresh(): Promise<void>; createLead(input: LeadInput): Promise<string | null>; updateLead(id: string, patch: LeadPatch): Promise<string | null> }` — realtime-subscribed to the `leads` table.
  - `useLead(id: string): { lead: Lead | null; loading: boolean; error: string | null; refresh(): Promise<void>; updateLead(patch: LeadPatch): Promise<string | null> }`
  - `AddLeadWizard({ open: boolean, onClose: () => void, onCreate(input: LeadInput): Promise<string | null> })`

- [ ] **Step 1: Write `src/lib/leadUpdates.ts`**

```ts
import { supabase } from './supabase';
import { stageInfo } from './utils';
import type { Lead } from '../types';

export type LeadPatch = Partial<Omit<Lead, 'id' | 'created_at' | 'updated_at' | 'created_by'>>;

/**
 * Updates a lead row and auto-logs any stage change to lead_notes
 * (this is the pipeline's activity history). Returns an error message or null.
 */
export async function applyLeadUpdate(
  id: string,
  patch: LeadPatch,
  before: Lead | null,
  userId?: string,
): Promise<string | null> {
  const { error } = await supabase.from('leads').update(patch).eq('id', id);
  if (error) return error.message;
  if (patch.stage && before && patch.stage !== before.stage) {
    await supabase.from('lead_notes').insert({
      lead_id: id,
      created_by: userId ?? null,
      note_type: 'general',
      content: `Stage changed: ${stageInfo(before.stage).label} → ${stageInfo(patch.stage).label}`,
    });
  }
  return null;
}
```

- [ ] **Step 2: Write `src/hooks/useLeads.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyLeadUpdate } from '../lib/leadUpdates';
import type { LeadPatch } from '../lib/leadUpdates';
import { useAuth } from './useAuth';
import type { Lead, PackageTier, Stage } from '../types';

export interface LeadInput {
  business_name: string;
  owner_name?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  postcode?: string | null;
  vertical?: string | null;
  stage?: Stage;
  package_tier?: PackageTier | null;
  deal_value?: number | null;
  assigned_to?: string | null;
  next_action_date?: string | null;
  next_action_note?: string | null;
}

/** All leads visible to the current user, kept fresh via a realtime subscription. */
export function useLeads() {
  const { session } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('leads').select('*').order('kanban_position').order('created_at');
    if (err) setError(err.message);
    else {
      setLeads(data as Lead[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel('leads-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  /** Inserts a lead owned by the current user; returns error message or null. */
  const createLead = useCallback(
    async (input: LeadInput): Promise<string | null> => {
      const stage = input.stage ?? 'new_lead';
      const maxPos = Math.max(0, ...leads.filter((l) => l.stage === stage).map((l) => l.kanban_position));
      const { error: err } = await supabase.from('leads').insert({
        ...input,
        stage,
        kanban_position: maxPos + 1,
        created_by: session?.user.id,
      });
      if (err) return err.message;
      await refresh();
      return null;
    },
    [leads, session, refresh],
  );

  /** Patches a lead (stage changes auto-logged); optimistic local update, then refresh. */
  const updateLead = useCallback(
    async (id: string, patch: LeadPatch): Promise<string | null> => {
      const before = leads.find((l) => l.id === id) ?? null;
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
      const err = await applyLeadUpdate(id, patch, before, session?.user.id);
      if (err) await refresh(); // roll back the optimistic update
      return err;
    },
    [leads, session, refresh],
  );

  return { leads, loading, error, refresh, createLead, updateLead };
}
```

- [ ] **Step 3: Write `src/hooks/useLead.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyLeadUpdate } from '../lib/leadUpdates';
import type { LeadPatch } from '../lib/leadUpdates';
import { useAuth } from './useAuth';
import type { Lead } from '../types';

/** A single lead by id (RLS-scoped). Used by the lead detail page. */
export function useLead(id: string) {
  const { session } = useAuth();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase.from('leads').select('*').eq('id', id).single();
    if (err) setError(err.message);
    else {
      setLead(data as Lead);
      setError(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  /** Patches this lead (stage changes auto-logged) and refreshes. */
  const updateLead = useCallback(
    async (patch: LeadPatch): Promise<string | null> => {
      const err = await applyLeadUpdate(id, patch, lead, session?.user.id);
      if (!err) await refresh();
      return err;
    },
    [id, lead, session, refresh],
  );

  return { lead, loading, error, refresh, updateLead };
}
```

- [ ] **Step 4: Write `src/components/pipeline/AddLeadWizard.tsx`**

Chunked form — 4 steps, max 3 fields each (ADHD rule 6), `StepProgress` always visible, back button always visible.

```tsx
import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input, SelectField } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { StepProgress } from '../ui/StepProgress';
import { PACKAGE_TIERS, STAGES } from '../../lib/utils';
import type { LeadInput } from '../../hooks/useLeads';
import type { PackageTier, Stage } from '../../types';

interface AddLeadWizardProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: LeadInput) => Promise<string | null>;
}

const EMPTY: LeadInput = { business_name: '' };
const TOTAL_STEPS = 4;

/** 4-step "Add lead" wizard: Company → Contact → Location → Deal. */
export function AddLeadWizard({ open, onClose, onCreate }: AddLeadWizardProps) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<LeadInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof LeadInput>(key: K, value: LeadInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    setStep(1);
    setForm(EMPTY);
    setError(null);
    onClose();
  }

  function next() {
    if (step === 1 && !form.business_name.trim()) {
      setError('Business name is required.');
      return;
    }
    setError(null);
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const err = await onCreate(form);
    setSubmitting(false);
    if (err) setError(err);
    else close();
  }

  return (
    <Modal open={open} onClose={close} title="Add lead">
      <div className="flex flex-col gap-5">
        <StepProgress step={step} total={TOTAL_STEPS} />

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <Input label="Business name *" value={form.business_name} onChange={(e) => set('business_name', e.target.value)} required />
            <Input label="Owner name" value={form.owner_name ?? ''} onChange={(e) => set('owner_name', e.target.value || null)} />
            <Input label="Vertical / industry" value={form.vertical ?? ''} onChange={(e) => set('vertical', e.target.value || null)} placeholder="e.g. Commercial cleaning" />
          </div>
        )}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <Input label="Phone" type="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value || null)} />
            <Input label="Email" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value || null)} />
            <Input label="Website" type="url" value={form.website ?? ''} onChange={(e) => set('website', e.target.value || null)} placeholder="https://" />
          </div>
        )}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <Input label="Address" value={form.address ?? ''} onChange={(e) => set('address', e.target.value || null)} />
            <Input label="City" value={form.city ?? ''} onChange={(e) => set('city', e.target.value || null)} />
            <Input label="Postcode" value={form.postcode ?? ''} onChange={(e) => set('postcode', e.target.value || null)} />
          </div>
        )}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <SelectField label="Stage" value={form.stage ?? 'new_lead'} onChange={(e) => set('stage', e.target.value as Stage)}>
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </SelectField>
            <SelectField label="Package tier" value={form.package_tier ?? ''} onChange={(e) => set('package_tier', (e.target.value || null) as PackageTier | null)}>
              <option value="">Not set</option>
              {PACKAGE_TIERS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </SelectField>
            <Input label="Deal value (£)" type="number" min="0" value={form.deal_value ?? ''} onChange={(e) => set('deal_value', e.target.value === '' ? null : Number(e.target.value))} />
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => (step === 1 ? close() : setStep(step - 1))}>
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step < TOTAL_STEPS ? (
            <Button onClick={next}>Next</Button>
          ) : (
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create lead'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 5: Wire the wizard into both pipeline stub pages**

Replace `src/pages/PipelineKanban.tsx` (still mostly a stub — the board arrives in Task 10):

```tsx
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useLeads } from '../hooks/useLeads';
import { Button } from '../components/ui/Button';
import { AddLeadWizard } from '../components/pipeline/AddLeadWizard';

/** Kanban pipeline view — board arrives in Task 10; Add-lead works now. */
export function PipelineKanban() {
  const { leads, createLead } = useLeads();
  const [wizardOpen, setWizardOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-extrabold">Pipeline</h1>
        <Button onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          Add lead
        </Button>
      </div>
      <p className="text-muted">{leads.length} lead(s) — Kanban board coming in Task 10.</p>
      <AddLeadWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={createLead} />
    </div>
  );
}
```

Make the identical change to `src/pages/PipelineList.tsx` (same imports and layout; heading text stays "Pipeline", body text "…List view coming in Task 12."). Repeat the full pattern — do not share a temp component; both files are fully replaced by their real implementations in Tasks 10 and 12.

- [ ] **Step 6: Verify in browser**

1. `/pipeline/kanban` → "Add lead" → walk all 4 steps (Step X of 4 progress bar updates; Back works) → Create.
2. The count line updates to "1 lead(s)" — realtime + refresh path works.
3. Try creating a lead with an empty business name → inline error on step 1, wizard does not advance.
4. In Supabase Table Editor: `leads` row exists with `created_by` = Kevin's user id, `stage` = chosen stage.

- [ ] **Step 7: Commit**

```bash
git add src/lib/leadUpdates.ts src/hooks/useLeads.ts src/hooks/useLead.ts src/components/pipeline/AddLeadWizard.tsx src/pages/PipelineKanban.tsx src/pages/PipelineList.tsx
git commit -m "feat: lead data layer with realtime + stage-change logging, add-lead wizard"
```

---

### Task 9: Stage visuals + compact LeadCard

**Files:**
- Create: `src/components/pipeline/stageStyles.ts`
- Create: `src/components/pipeline/StageBadge.tsx`
- Create: `src/components/pipeline/LeadCard.tsx`

**Interfaces:**
- Consumes: `Stage`/`Lead` types, `stageInfo`, `dueLabel`/`isOverdue`/`isDueToday`, `initials`, `Badge`.
- Produces:
  - `STAGE_BADGE_CLASSES: Record<Stage, string>` and `STAGE_BORDER_CLASSES: Record<Stage, string>` — literal Tailwind arbitrary-value classes (Tailwind only sees literal strings, so these MUST stay written out, never computed).
  - `STAGE_ICONS: Record<Stage, LucideIcon>`
  - `StageBadge({ stage: Stage })` — icon + colour + label (ADHD rule 1).
  - `LeadCard({ lead: Lead, assigneeName?: string | null, onOpen?: (lead: Lead) => void })` — compact card per SPEC.md §6.

- [ ] **Step 1: Write `src/components/pipeline/stageStyles.ts`**

```ts
import {
  CalendarCheck, Clock, FileText, Handshake, PhoneCall, Sparkles, Trophy, XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Stage } from '../../types';

/** Badge colour classes per stage — literal strings so Tailwind can compile them. */
export const STAGE_BADGE_CLASSES: Record<Stage, string> = {
  new_lead: 'bg-[#94A3B8]/15 text-[#94A3B8]',
  contacted: 'bg-[#8B32FF]/15 text-[#B57BFF]',
  audit_booked: 'bg-[#00DFDF]/15 text-[#00DFDF]',
  proposal_sent: 'bg-[#F59E0B]/15 text-[#F59E0B]',
  negotiating: 'bg-[#F97316]/15 text-[#F97316]',
  won: 'bg-[#22C55E]/15 text-[#22C55E]',
  lost: 'bg-[#EF4444]/15 text-[#EF4444]',
  not_now_nurture: 'bg-[#64378B]/25 text-[#C9A6E8]',
};

/** Card left-border colour classes per stage. */
export const STAGE_BORDER_CLASSES: Record<Stage, string> = {
  new_lead: 'border-l-[#94A3B8]',
  contacted: 'border-l-[#8B32FF]',
  audit_booked: 'border-l-[#00DFDF]',
  proposal_sent: 'border-l-[#F59E0B]',
  negotiating: 'border-l-[#F97316]',
  won: 'border-l-[#22C55E]',
  lost: 'border-l-[#EF4444]',
  not_now_nurture: 'border-l-[#64378B]',
};

/** One icon per stage — every stage indicator is icon + colour + label, never colour alone. */
export const STAGE_ICONS: Record<Stage, LucideIcon> = {
  new_lead: Sparkles,
  contacted: PhoneCall,
  audit_booked: CalendarCheck,
  proposal_sent: FileText,
  negotiating: Handshake,
  won: Trophy,
  lost: XCircle,
  not_now_nurture: Clock,
};
```

(Note: `contacted` and `not_now_nurture` badge TEXT colours are lightened variants of the stage hex — the raw violet/purple fail WCAG AA on the dark card background at 12px. The border and column dot still use the exact spec hex.)

- [ ] **Step 2: Write `src/components/pipeline/StageBadge.tsx`**

```tsx
import { Badge } from '../ui/Badge';
import { stageInfo } from '../../lib/utils';
import { STAGE_BADGE_CLASSES, STAGE_ICONS } from './stageStyles';
import type { Stage } from '../../types';

/** Stage pill: icon + colour + label (ADHD rule: never colour-only). */
export function StageBadge({ stage }: { stage: Stage }) {
  const Icon = STAGE_ICONS[stage];
  return (
    <Badge className={STAGE_BADGE_CLASSES[stage]}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {stageInfo(stage).label}
    </Badge>
  );
}
```

- [ ] **Step 3: Write `src/components/pipeline/LeadCard.tsx`**

```tsx
import { useState } from 'react';
import { AlertCircle, Copy, Phone } from 'lucide-react';
import type { Lead } from '../../types';
import { dueLabel, initials, isDueToday, isOverdue } from '../../lib/utils';
import { STAGE_BORDER_CLASSES } from './stageStyles';

interface LeadCardProps {
  lead: Lead;
  assigneeName?: string | null;
  onOpen?: (lead: Lead) => void;
}

/**
 * Compact lead card (SPEC.md §6): company, phone (tel:), copyable email,
 * next-action indicator when due/overdue, assignee initials chip.
 */
export function LeadCard({ lead, assigneeName, onOpen }: LeadCardProps) {
  const [copied, setCopied] = useState(false);
  const due = lead.next_action_date !== null && (isOverdue(lead.next_action_date) || isDueToday(lead.next_action_date));

  function copyEmail(e: React.MouseEvent) {
    e.stopPropagation();
    if (!lead.email) return;
    void navigator.clipboard.writeText(lead.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(lead)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen?.(lead);
      }}
      className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border border-line border-l-4 bg-card p-3 text-left hover:bg-surface/60 ${STAGE_BORDER_CLASSES[lead.stage]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-heading text-sm font-bold">{lead.business_name}</p>
        {assigneeName && (
          <span aria-label={`Assigned to ${assigneeName}`} title={assigneeName} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple text-[10px] font-bold">
            {initials(assigneeName)}
          </span>
        )}
      </div>
      {lead.phone && (
        <a href={`tel:${lead.phone}`} onClick={(e) => e.stopPropagation()} className="flex min-h-6 items-center gap-1.5 text-sm text-muted hover:text-cyan">
          <Phone className="h-3.5 w-3.5" aria-hidden />
          {lead.phone}
        </a>
      )}
      {lead.email && (
        <button type="button" onClick={copyEmail} title="Copy email" className="flex min-h-6 cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-cyan">
          <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{copied ? 'Copied ✓' : lead.email}</span>
        </button>
      )}
      {due && lead.next_action_date && (
        <p className={`flex items-center gap-1.5 text-xs font-semibold ${isOverdue(lead.next_action_date) ? 'text-red-400' : 'text-cyan'}`}>
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          {dueLabel(lead.next_action_date)}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify it compiles, commit**

Run: `npm run build` — exits 0.

```bash
git add src/components/pipeline/stageStyles.ts src/components/pipeline/StageBadge.tsx src/components/pipeline/LeadCard.tsx
git commit -m "feat: stage colour/icon system, StageBadge, compact LeadCard"
```

---

### Task 10: Kanban board with drag-and-drop

**Files:**
- Create: `src/components/pipeline/KanbanColumn.tsx`
- Create: `src/components/pipeline/KanbanBoard.tsx`
- Create: `src/components/pipeline/ViewToggle.tsx`
- Modify: `src/pages/PipelineKanban.tsx` (replace stub content with the board)

**Interfaces:**
- Consumes: `useLeads`, `useProfiles`, `LeadCard`, `STAGES`, `STAGE_ICONS`, `STAGE_BADGE_CLASSES`, `@dnd-kit/core`.
- Produces:
  - `ViewToggle()` — kanban/list segmented control; persists choice to `localStorage['pipeline-view']`. Reused by Task 12.
  - `KanbanBoard({ leads, onMove(id: string, stage: Stage, position: number), onOpen(lead: Lead), assigneeNameFor(lead: Lead): string | null })`
- Drag-and-drop scope for cycle 1: cards move **between columns** (dropped at the end of the target column). Reordering within a column is deferred — `kanban_position` still orders columns deterministically.

- [ ] **Step 1: Write `src/components/pipeline/ViewToggle.tsx`**

```tsx
import { useNavigate } from 'react-router';
import { KanbanSquare, List } from 'lucide-react';

/** Kanban/List segmented toggle; remembers the choice in localStorage. */
export function ViewToggle({ current }: { current: 'kanban' | 'list' }) {
  const navigate = useNavigate();

  function go(view: 'kanban' | 'list') {
    localStorage.setItem('pipeline-view', view);
    navigate(`/pipeline/${view}`);
  }

  const base = 'flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-semibold transition-colors motion-reduce:transition-none';
  return (
    <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Pipeline view">
      <button type="button" onClick={() => go('kanban')} aria-pressed={current === 'kanban'} className={`${base} ${current === 'kanban' ? 'bg-violet/25 text-offwhite' : 'text-muted hover:text-offwhite'}`}>
        <KanbanSquare className="h-4 w-4" aria-hidden />
        Kanban
      </button>
      <button type="button" onClick={() => go('list')} aria-pressed={current === 'list'} className={`${base} ${current === 'list' ? 'bg-violet/25 text-offwhite' : 'text-muted hover:text-offwhite'}`}>
        <List className="h-4 w-4" aria-hidden />
        List
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/pipeline/KanbanColumn.tsx`**

```tsx
import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { stageInfo } from '../../lib/utils';
import { STAGE_BADGE_CLASSES, STAGE_ICONS } from './stageStyles';
import type { Stage } from '../../types';

interface KanbanColumnProps {
  stage: Stage;
  count: number;
  children: ReactNode;
}

/** One droppable pipeline column with an icon+colour+label header. */
export function KanbanColumn({ stage, count, children }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });
  const Icon = STAGE_ICONS[stage];
  return (
    <section
      ref={setNodeRef}
      aria-label={stageInfo(stage).label}
      className={`flex w-64 shrink-0 flex-col gap-2 rounded-xl border p-2 ${isOver ? 'border-cyan bg-surface/50' : 'border-line bg-navy/30'}`}
    >
      <header className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold ${STAGE_BADGE_CLASSES[stage]}`}>
        <Icon className="h-4 w-4" aria-hidden />
        {stageInfo(stage).label}
        <span className="ml-auto rounded-full bg-black/25 px-2 py-0.5">{count}</span>
      </header>
      <div className="flex min-h-24 flex-col gap-2 overflow-y-auto">{children}</div>
    </section>
  );
}
```

- [ ] **Step 3: Write `src/components/pipeline/KanbanBoard.tsx`**

```tsx
import { useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { STAGES } from '../../lib/utils';
import { KanbanColumn } from './KanbanColumn';
import { LeadCard } from './LeadCard';
import type { Lead, Stage } from '../../types';

interface KanbanBoardProps {
  leads: Lead[];
  onMove: (id: string, stage: Stage, position: number) => void;
  onOpen: (lead: Lead) => void;
  assigneeNameFor: (lead: Lead) => string | null;
}

function Draggable({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={isDragging ? 'opacity-40' : ''}>
      {children}
    </div>
  );
}

/** 8-column pipeline board; drag a card onto another column to change its stage. */
export function KanbanBoard({ leads, onMove, onOpen, assigneeNameFor }: KanbanBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [active, setActive] = useState<Lead | null>(null);

  function handleDragStart(e: DragStartEvent) {
    setActive(leads.find((l) => l.id === e.active.id) ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    const lead = leads.find((l) => l.id === e.active.id);
    const target = e.over?.id as Stage | undefined;
    setActive(null);
    if (!lead || !target || lead.stage === target) return;
    const maxPos = Math.max(0, ...leads.filter((l) => l.stage === target).map((l) => l.kanban_position));
    onMove(lead.id, target, maxPos + 1);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((s) => {
          const columnLeads = leads.filter((l) => l.stage === s.value);
          return (
            <KanbanColumn key={s.value} stage={s.value} count={columnLeads.length}>
              {columnLeads.map((lead) => (
                <Draggable key={lead.id} id={lead.id}>
                  <LeadCard lead={lead} assigneeName={assigneeNameFor(lead)} onOpen={onOpen} />
                </Draggable>
              ))}
            </KanbanColumn>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {active && <LeadCard lead={active} assigneeName={assigneeNameFor(active)} />}
      </DragOverlay>
    </DndContext>
  );
}
```

- [ ] **Step 4: Replace `src/pages/PipelineKanban.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Inbox, Plus } from 'lucide-react';
import { useLeads } from '../hooks/useLeads';
import { useProfiles } from '../hooks/useProfiles';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { AddLeadWizard } from '../components/pipeline/AddLeadWizard';
import { KanbanBoard } from '../components/pipeline/KanbanBoard';
import { ViewToggle } from '../components/pipeline/ViewToggle';
import type { Lead, Stage } from '../types';

/** Kanban pipeline page (desktop). Mobile users are pointed to the list view. */
export function PipelineKanban() {
  const { leads, loading, error, createLead, updateLead } = useLeads();
  const { profiles } = useProfiles();
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);

  function assigneeNameFor(lead: Lead): string | null {
    if (!lead.assigned_to) return null;
    const p = profiles.find((x) => x.id === lead.assigned_to);
    return p?.full_name ?? p?.email ?? null;
  }

  function handleMove(id: string, stage: Stage, position: number) {
    void updateLead(id, { stage, kanban_position: position });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Pipeline</h1>
        <div className="flex items-center gap-3">
          <ViewToggle current="kanban" />
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add lead
          </Button>
        </div>
      </div>

      <p className="rounded-lg border border-line bg-card p-4 text-sm text-muted md:hidden">
        The Kanban board works best on desktop. Use the List view here on mobile — your progress is saved.
      </p>

      <div className="hidden md:block">
        {loading && (
          <div className="flex gap-3">
            <Skeleton className="h-72 w-64" />
            <Skeleton className="h-72 w-64" />
            <Skeleton className="h-72 w-64" />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {!loading && !error && leads.length === 0 && (
          <EmptyState
            icon={Inbox}
            title="No leads yet"
            hint="Add your first lead to start working the pipeline."
            action={<Button onClick={() => setWizardOpen(true)}>Add lead</Button>}
          />
        )}
        {!loading && !error && leads.length > 0 && (
          <KanbanBoard
            leads={leads}
            onMove={handleMove}
            onOpen={(lead) => navigate(`/pipeline/leads/${lead.id}`)}
            assigneeNameFor={assigneeNameFor}
          />
        )}
      </div>

      <AddLeadWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={createLead} />
    </div>
  );
}
```

(Card click navigates to the detail page for now; Task 11 swaps this to open the side panel.)

- [ ] **Step 5: Verify in browser**

1. `/pipeline/kanban` → 8 columns in spec order, each header showing icon + label + count.
2. Add 3 leads via the wizard (different stages) → they appear in the right columns.
3. Drag a card from New Lead to Contacted → card moves; refresh → it stayed (DB persisted); a `lead_notes` row "Stage changed: New Lead → Contacted" exists in Supabase Table Editor.
4. Open the app in a second browser window signed in as Kevin → drag a card in window 1 → window 2 updates within ~1s (realtime).
5. Toggle to List → URL is `/pipeline/list`; go to `/pipeline` → redirects to `/pipeline/list` (persisted choice); toggle back to Kanban.
6. Click a card (not drag) → navigates to the lead detail stub.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipeline src/pages/PipelineKanban.tsx
git commit -m "feat: kanban board with dnd-kit column drag-and-drop and view toggle"
```

---

### Task 11: Expanded lead panel (slide-in) + notes hook + next-action editor

**Files:**
- Create: `src/hooks/useLeadNotes.ts`
- Create: `src/components/pipeline/NextActionEditor.tsx`
- Create: `src/components/pipeline/LeadPanel.tsx`
- Create: `src/components/pipeline/LeadPanelSections.tsx`
- Modify: `src/pages/PipelineKanban.tsx` (card click opens the panel instead of navigating)

**Interfaces:**
- Consumes: `useLead` types, `applyLeadUpdate` via the page's `updateLead`, `StageBadge`, `SelectField`, utils.
- Produces:
  - `useLeadNotes(leadId: string): { notes: LeadNote[]; loading: boolean; error: string | null; refresh(): Promise<void>; addNote(content: string, noteType: NoteType): Promise<string | null> }` — `addNote` with `noteType === 'call'` also increments `leads.call_count` and sets `last_contacted_at = now()`. Reused by Tasks 13 and 14.
  - `NextActionEditor({ lead: Lead, onSave(patch: { next_action_date: string | null; next_action_note: string | null }): Promise<string | null> })` — inline edit with auto-save indicator (no modal; ADHD rule 13). Reused by Task 13.
  - `LeadPanel({ lead: Lead | null, profiles: Profile[], onClose(), onUpdate(id: string, patch: LeadPatch): Promise<string | null> })` — right slide-in panel; renders nothing when `lead` is null. Reused by Task 12.

- [ ] **Step 1: Write `src/hooks/useLeadNotes.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { LeadNote, NoteType } from '../types';

/** Notes for one lead, newest first. addNote('...', 'call') also bumps call_count. */
export function useLeadNotes(leadId: string) {
  const { session } = useAuth();
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('lead_notes').select('*').eq('lead_id', leadId).order('created_at', { ascending: false });
    if (err) setError(err.message);
    else {
      setNotes(data as LeadNote[]);
      setError(null);
    }
    setLoading(false);
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  /** Inserts a note; call notes also update the lead's call stats. Returns error or null. */
  const addNote = useCallback(
    async (content: string, noteType: NoteType): Promise<string | null> => {
      const { error: err } = await supabase.from('lead_notes').insert({
        lead_id: leadId,
        created_by: session?.user.id,
        content,
        note_type: noteType,
      });
      if (err) return err.message;
      if (noteType === 'call') {
        const { data: lead } = await supabase.from('leads').select('call_count').eq('id', leadId).single();
        await supabase
          .from('leads')
          .update({ call_count: ((lead as { call_count: number } | null)?.call_count ?? 0) + 1, last_contacted_at: new Date().toISOString() })
          .eq('id', leadId);
      }
      await refresh();
      return null;
    },
    [leadId, session, refresh],
  );

  return { notes, loading, error, refresh, addNote };
}
```

- [ ] **Step 2: Write `src/components/pipeline/NextActionEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { Lead } from '../../types';
import { Input } from '../ui/Input';

interface NextActionEditorProps {
  lead: Lead;
  onSave: (patch: { next_action_date: string | null; next_action_note: string | null }) => Promise<string | null>;
}

/** Inline next-action editor: date + note, saves on blur with a subtle status indicator. */
export function NextActionEditor({ lead, onSave }: NextActionEditorProps) {
  const [date, setDate] = useState(lead.next_action_date ?? '');
  const [note, setNote] = useState(lead.next_action_note ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setDate(lead.next_action_date ?? '');
    setNote(lead.next_action_note ?? '');
    setStatus('idle');
  }, [lead.id, lead.next_action_date, lead.next_action_note]);

  async function save() {
    if (date === (lead.next_action_date ?? '') && note === (lead.next_action_note ?? '')) return;
    setStatus('saving');
    const err = await onSave({ next_action_date: date || null, next_action_note: note || null });
    setStatus(err ? 'error' : 'saved');
  }

  return (
    <div className="flex flex-col gap-3">
      <Input label="Next action date" type="date" value={date} onChange={(e) => setDate(e.target.value)} onBlur={() => void save()} />
      <Input label="Next action note" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => void save()} placeholder="e.g. Chase proposal by phone" />
      <p aria-live="polite" className="min-h-5 text-xs text-muted">
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && 'Saved ✓'}
        {status === 'error' && <span className="text-red-400">Could not save — check your connection.</span>}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/components/pipeline/LeadPanelSections.tsx`**

Small presentational pieces the panel composes (keeps every file under 150 lines):

```tsx
import { ExternalLink, Mail, Phone, Star } from 'lucide-react';
import type { Lead, LeadNote } from '../../types';
import { formatCurrency, formatShortDate, packageLabel } from '../../lib/utils';
import { Skeleton } from '../ui/Skeleton';

/** Label/value row used throughout the panel. */
export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

/** Contact block: phone (tel:), email (mailto:), website. */
export function ContactInfo({ lead }: { lead: Lead }) {
  return (
    <div className="flex flex-col gap-1">
      {lead.phone && (
        <a href={`tel:${lead.phone}`} className="flex min-h-11 items-center gap-2 text-sm hover:text-cyan">
          <Phone className="h-4 w-4 text-muted" aria-hidden />{lead.phone}
        </a>
      )}
      {lead.email && (
        <a href={`mailto:${lead.email}`} className="flex min-h-11 items-center gap-2 text-sm hover:text-cyan">
          <Mail className="h-4 w-4 text-muted" aria-hidden />{lead.email}
        </a>
      )}
      {lead.website && (
        <a href={lead.website} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 text-sm hover:text-cyan">
          <ExternalLink className="h-4 w-4 text-muted" aria-hidden />
          <span className="truncate">{lead.website}</span>
        </a>
      )}
      {!lead.phone && !lead.email && !lead.website && <p className="text-sm text-muted">No contact details yet.</p>}
    </div>
  );
}

/** Pipeline block: package, value, vertical, rating, call stats. */
export function PipelineInfo({ lead }: { lead: Lead }) {
  return (
    <div>
      <InfoRow label="Package">{packageLabel(lead.package_tier)}</InfoRow>
      <InfoRow label="Deal value">{lead.deal_value !== null ? formatCurrency(lead.deal_value) : '—'}</InfoRow>
      <InfoRow label="Vertical">{lead.vertical ?? '—'}</InfoRow>
      <InfoRow label="Google rating">
        {lead.google_rating !== null ? (
          <span className="inline-flex items-center gap-1">
            <Star className="h-3.5 w-3.5 text-amber-400" aria-hidden />
            {lead.google_rating} ({lead.review_count ?? 0} reviews)
          </span>
        ) : '—'}
      </InfoRow>
      <InfoRow label="Calls made">{lead.call_count}</InfoRow>
      <InfoRow label="Last contacted">{lead.last_contacted_at ? formatShortDate(lead.last_contacted_at) : 'Never'}</InfoRow>
    </div>
  );
}

/** Latest-notes preview (last 2) with loading/empty states. */
export function NotesPreview({ notes, loading }: { notes: LeadNote[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-16 w-full" />;
  if (notes.length === 0) return <p className="text-sm text-muted">No notes yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {notes.slice(0, 2).map((n) => (
        <li key={n.id} className="rounded-lg bg-surface/60 p-2 text-sm">
          <p className="line-clamp-3 whitespace-pre-wrap">{n.content}</p>
          <p className="mt-1 text-xs text-muted">{formatShortDate(n.created_at)}</p>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Write `src/components/pipeline/LeadPanel.tsx`**

```tsx
import { useNavigate } from 'react-router';
import { ArrowRight, X } from 'lucide-react';
import type { LeadPatch } from '../../lib/leadUpdates';
import { STAGES } from '../../lib/utils';
import { useLeadNotes } from '../../hooks/useLeadNotes';
import { useAuth } from '../../hooks/useAuth';
import type { Lead, Profile, Stage } from '../../types';
import { Button } from '../ui/Button';
import { SelectField } from '../ui/Input';
import { StageBadge } from './StageBadge';
import { NextActionEditor } from './NextActionEditor';
import { ContactInfo, NotesPreview, PipelineInfo } from './LeadPanelSections';

interface LeadPanelProps {
  lead: Lead | null;
  profiles: Profile[];
  onClose: () => void;
  onUpdate: (id: string, patch: LeadPatch) => Promise<string | null>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line pb-4">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

/** Right slide-in expanded card (SPEC.md §6). Renders nothing when no lead selected. */
export function LeadPanel({ lead, profiles, onClose, onUpdate }: LeadPanelProps) {
  const navigate = useNavigate();
  const { profile: me } = useAuth();
  const { notes, loading: notesLoading } = useLeadNotes(lead?.id ?? 'none');

  if (!lead) return null;
  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside
        role="dialog"
        aria-label={lead.business_name}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-line bg-card p-5 motion-safe:animate-[slidein_.15s_ease-out]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-bold">{lead.business_name}</h2>
            {lead.owner_name && <p className="text-sm text-muted">{lead.owner_name}</p>}
            <div className="mt-2"><StageBadge stage={lead.stage} /></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close panel" className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <Section title="Stage">
          <SelectField label="Move to stage" value={lead.stage} onChange={(e) => void onUpdate(lead.id, { stage: e.target.value as Stage })}>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </SelectField>
        </Section>

        <Section title="Contact"><ContactInfo lead={lead} /></Section>
        <Section title="Pipeline"><PipelineInfo lead={lead} /></Section>

        <Section title="Next action">
          <NextActionEditor lead={lead} onSave={(patch) => onUpdate(lead.id, patch)} />
        </Section>

        {me?.role === 'admin' && (
          <Section title="Assignment">
            <SelectField label="Assigned to" value={lead.assigned_to ?? ''} onChange={(e) => void onUpdate(lead.id, { assigned_to: e.target.value || null })}>
              <option value="">Unassigned</option>
              {profiles.filter((p) => p.role === 'contractor').map((p) => (
                <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
              ))}
            </SelectField>
          </Section>
        )}

        <Section title="Recent notes"><NotesPreview notes={notes} loading={notesLoading} /></Section>

        <div className="mt-auto flex flex-col gap-2">
          <Button onClick={() => navigate(`/pipeline/leads/${lead.id}`)}>
            Open full record <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" disabled title="Email automation arrives in cycle 2">Draft email</Button>
            <Button variant="secondary" className="flex-1" disabled title="Sequences arrive in cycle 2">Enroll in sequence</Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
```

(Note: `useLeadNotes(lead?.id ?? 'none')` — hooks can't be conditional; the `'none'` id fetches nothing and errors silently into the empty state, which is fine because the panel renders `null` anyway. Task 14 adds the real "Log note" button here.)

- [ ] **Step 5: Wire the panel into `src/pages/PipelineKanban.tsx`**

Add state + swap the `onOpen` handler. Changes to the existing file:

```tsx
// add imports
import { LeadPanel } from '../components/pipeline/LeadPanel';

// inside the component, replace `const navigate = useNavigate();` usage for cards:
const [selected, setSelected] = useState<Lead | null>(null);

// keep the selected lead fresh when realtime refreshes the list:
useEffect(() => {
  if (selected) setSelected(leads.find((l) => l.id === selected.id) ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [leads]);

// KanbanBoard prop changes from navigate(...) to:
onOpen={(lead) => setSelected(lead)}

// render the panel after AddLeadWizard:
<LeadPanel lead={selected} profiles={profiles} onClose={() => setSelected(null)} onUpdate={updateLead} />
```

(`useNavigate` import can be removed from the page; add `useEffect` to the react import.)

- [ ] **Step 6: Verify in browser**

1. Click a Kanban card → panel slides in from the right with all sections.
2. Change stage via the dropdown → card jumps columns behind the panel; badge in panel updates.
3. Set a next action date of yesterday via the date input → blur → "Saved ✓"; close panel → card shows red "1 day overdue".
4. As admin, assign the lead to your test contractor → initials chip appears on the card.
5. "Open full record" navigates to `/pipeline/leads/:id` (stub).
6. Escape/overlay click closes the panel.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useLeadNotes.ts src/components/pipeline src/pages/PipelineKanban.tsx
git commit -m "feat: expanded lead side panel with inline stage/next-action/assignment editing"
```

---

### Task 12: List view — search, filters, sortable table (logic TDD)

**Files:**
- Create: `src/lib/leadFilters.ts`
- Test: `src/lib/leadFilters.test.ts`
- Create: `src/components/ui/MultiSelect.tsx`
- Create: `src/components/pipeline/FilterBar.tsx`
- Create: `src/components/pipeline/ListTable.tsx`
- Modify: `src/pages/PipelineList.tsx` (replace stub)

**Interfaces:**
- Consumes: `useLeads`, `useProfiles`, `LeadPanel`, `ViewToggle`, `StageBadge`, utils.
- Produces:
  - `LeadFilters = { search: string; stages: Stage[]; assignees: string[]; overdueOnly: boolean }`
  - `filterLeads(leads: Lead[], filters: LeadFilters, today?: Date): Lead[]` — case-insensitive substring match on business_name/owner_name/email; empty `stages`/`assignees` arrays mean "all".
  - `SortKey = 'business_name' | 'owner_name' | 'stage' | 'package_tier' | 'deal_value' | 'next_action_date' | 'last_contacted_at'`
  - `sortLeads(leads: Lead[], key: SortKey, dir: 'asc' | 'desc'): Lead[]` — nulls always last; `stage` sorts by pipeline order (STAGES index), not alphabetically.
  - `MultiSelect({ label: string, options: { value: string; label: string }[], selected: string[], onChange(selected: string[]) })`
- The page reads `?stage=<stage>` from the URL to pre-filter (used by the dashboard's pipeline snapshot in Task 15).

- [ ] **Step 1: Write the failing tests**

`src/lib/leadFilters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filterLeads, sortLeads } from './leadFilters';
import type { Lead } from '../types';

const TODAY = new Date(2026, 6, 12);

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: crypto.randomUUID(),
    business_name: 'Acme Ltd', owner_name: null, phone: null, email: null,
    website: null, address: null, city: null, postcode: null,
    google_rating: null, review_count: null, vertical: null,
    stage: 'new_lead', package_tier: null, deal_value: null,
    assigned_to: null, created_by: null, raw_lead_id: null,
    next_action_date: null, next_action_note: null,
    call_count: 0, last_contacted_at: null, kanban_position: 0,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

const NONE = { search: '', stages: [], assignees: [], overdueOnly: false };

describe('filterLeads', () => {
  const leads = [
    makeLead({ business_name: 'Shiny Cleaners', email: 'info@shiny.co.uk', stage: 'contacted', assigned_to: 'u1', next_action_date: '2026-07-10' }),
    makeLead({ business_name: 'Bright Sparks', owner_name: 'Ana Diaz', stage: 'won', assigned_to: 'u2' }),
    makeLead({ business_name: 'Dull & Sons', stage: 'contacted', next_action_date: '2026-07-14' }),
  ];

  it('no filters returns everything', () => {
    expect(filterLeads(leads, NONE, TODAY)).toHaveLength(3);
  });
  it('search matches name, owner and email, case-insensitively', () => {
    expect(filterLeads(leads, { ...NONE, search: 'SHINY' }, TODAY)).toHaveLength(1);
    expect(filterLeads(leads, { ...NONE, search: 'diaz' }, TODAY)).toHaveLength(1);
    expect(filterLeads(leads, { ...NONE, search: 'shiny.co' }, TODAY)).toHaveLength(1);
  });
  it('stage filter is OR within the list', () => {
    expect(filterLeads(leads, { ...NONE, stages: ['contacted'] }, TODAY)).toHaveLength(2);
    expect(filterLeads(leads, { ...NONE, stages: ['contacted', 'won'] }, TODAY)).toHaveLength(3);
  });
  it('assignee filter', () => {
    expect(filterLeads(leads, { ...NONE, assignees: ['u1'] }, TODAY)).toHaveLength(1);
  });
  it('overdueOnly keeps only past-due leads', () => {
    const result = filterLeads(leads, { ...NONE, overdueOnly: true }, TODAY);
    expect(result).toHaveLength(1);
    expect(result[0]!.business_name).toBe('Shiny Cleaners');
  });
});

describe('sortLeads', () => {
  const leads = [
    makeLead({ business_name: 'Beta', deal_value: null, stage: 'won' }),
    makeLead({ business_name: 'Alpha', deal_value: 500, stage: 'contacted' }),
    makeLead({ business_name: 'Gamma', deal_value: 100, stage: 'new_lead' }),
  ];

  it('sorts strings asc/desc', () => {
    expect(sortLeads(leads, 'business_name', 'asc').map((l) => l.business_name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(sortLeads(leads, 'business_name', 'desc').map((l) => l.business_name)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });
  it('numbers sort with nulls last regardless of direction', () => {
    expect(sortLeads(leads, 'deal_value', 'asc').map((l) => l.deal_value)).toEqual([100, 500, null]);
    expect(sortLeads(leads, 'deal_value', 'desc').map((l) => l.deal_value)).toEqual([500, 100, null]);
  });
  it('stage sorts in pipeline order, not alphabetical', () => {
    expect(sortLeads(leads, 'stage', 'asc').map((l) => l.stage)).toEqual(['new_lead', 'contacted', 'won']);
  });
  it('does not mutate the input array', () => {
    const copy = [...leads];
    sortLeads(leads, 'business_name', 'asc');
    expect(leads).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './leadFilters'`.

- [ ] **Step 3: Write `src/lib/leadFilters.ts`**

```ts
import { isOverdue, STAGES } from './utils';
import type { Lead, Stage } from '../types';

export interface LeadFilters {
  search: string;
  stages: Stage[];
  assignees: string[];
  overdueOnly: boolean;
}

/** Applies search + stage + assignee + overdue filters. Empty arrays mean "all". */
export function filterLeads(leads: Lead[], filters: LeadFilters, today: Date = new Date()): Lead[] {
  const q = filters.search.trim().toLowerCase();
  return leads.filter((lead) => {
    if (q) {
      const haystack = `${lead.business_name} ${lead.owner_name ?? ''} ${lead.email ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (filters.stages.length > 0 && !filters.stages.includes(lead.stage)) return false;
    if (filters.assignees.length > 0 && (!lead.assigned_to || !filters.assignees.includes(lead.assigned_to))) return false;
    if (filters.overdueOnly && !isOverdue(lead.next_action_date, today)) return false;
    return true;
  });
}

export type SortKey =
  | 'business_name' | 'owner_name' | 'stage' | 'package_tier'
  | 'deal_value' | 'next_action_date' | 'last_contacted_at';

const STAGE_ORDER = new Map(STAGES.map((s, i) => [s.value, i]));

function sortValue(lead: Lead, key: SortKey): string | number | null {
  if (key === 'stage') return STAGE_ORDER.get(lead.stage) ?? null;
  return lead[key];
}

/** Returns a new sorted array. Nulls sort last in both directions; stage uses pipeline order. */
export function sortLeads(leads: Lead[], key: SortKey, dir: 'asc' | 'desc'): Lead[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...leads].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
    return String(va).localeCompare(String(vb)) * sign;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS (utils tests still green too).

- [ ] **Step 5: Commit the logic**

```bash
git add src/lib/leadFilters.ts src/lib/leadFilters.test.ts
git commit -m "feat: lead filter + sort logic with tests"
```

- [ ] **Step 6: Write `src/components/ui/MultiSelect.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface MultiSelectProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

/** Checkbox dropdown for multi-value filters. Button shows a count when active. */
export function MultiSelect({ label, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${selected.length > 0 ? 'border-cyan text-offwhite' : 'border-line text-muted'}`}
      >
        {label}{selected.length > 0 ? ` (${selected.length})` : ''}
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 flex max-h-64 min-w-48 flex-col overflow-y-auto rounded-lg border border-line bg-card p-1 shadow-xl">
          {options.map((opt) => (
            <label key={opt.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-surface">
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} className="h-4 w-4 accent-violet-500" />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Write `src/components/pipeline/FilterBar.tsx`**

```tsx
import { AlertCircle, Search } from 'lucide-react';
import { STAGES } from '../../lib/utils';
import type { LeadFilters } from '../../lib/leadFilters';
import type { Profile } from '../../types';
import type { Stage } from '../../types';
import { MultiSelect } from '../ui/MultiSelect';
import { useAuth } from '../../hooks/useAuth';

interface FilterBarProps {
  filters: LeadFilters;
  onChange: (filters: LeadFilters) => void;
  profiles: Profile[];
}

/** Search + stage/assignee multi-selects + overdue toggle (SPEC.md §6 list view). */
export function FilterBar({ filters, onChange, profiles }: FilterBarProps) {
  const { profile: me } = useAuth();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          aria-label="Search leads"
          placeholder="Search company, owner, email…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="min-h-11 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-base outline-none placeholder:text-muted focus:border-cyan"
        />
      </div>
      <MultiSelect
        label="Stage"
        options={STAGES.map((s) => ({ value: s.value, label: s.label }))}
        selected={filters.stages}
        onChange={(stages) => onChange({ ...filters, stages: stages as Stage[] })}
      />
      {me?.role === 'admin' && (
        <MultiSelect
          label="Assigned to"
          options={profiles.map((p) => ({ value: p.id, label: p.full_name ?? p.email }))}
          selected={filters.assignees}
          onChange={(assignees) => onChange({ ...filters, assignees })}
        />
      )}
      <button
        type="button"
        onClick={() => onChange({ ...filters, overdueOnly: !filters.overdueOnly })}
        aria-pressed={filters.overdueOnly}
        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${filters.overdueOnly ? 'border-red-400 text-red-400' : 'border-line text-muted'}`}
      >
        <AlertCircle className="h-4 w-4" aria-hidden />
        Overdue only
      </button>
    </div>
  );
}
```

- [ ] **Step 8: Write `src/components/pipeline/ListTable.tsx`**

```tsx
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { SortKey } from '../../lib/leadFilters';
import { dueLabel, formatCurrency, formatShortDate, initials, isOverdue, packageLabel } from '../../lib/utils';
import type { Lead, Profile } from '../../types';
import { StageBadge } from './StageBadge';

interface ListTableProps {
  leads: Lead[];
  profiles: Profile[];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  onOpen: (lead: Lead) => void;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'business_name', label: 'Company' },
  { key: 'owner_name', label: 'Owner' },
  { key: 'stage', label: 'Stage' },
  { key: 'package_tier', label: 'Package' },
  { key: 'deal_value', label: 'Value' },
  { key: 'next_action_date', label: 'Next action' },
  { key: 'last_contacted_at', label: 'Last contacted' },
];

/** Sortable full-width lead table with sticky header; row click opens the panel. */
export function ListTable({ leads, profiles, sortKey, sortDir, onSort, onOpen }: ListTableProps) {
  function assignee(lead: Lead): string {
    const p = profiles.find((x) => x.id === lead.assigned_to);
    return p ? initials(p.full_name ?? p.email) : '—';
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-navy">
          <tr className="border-b border-line text-xs font-semibold text-muted">
            {COLUMNS.map((col) => (
              <th key={col.key} aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => onSort(col.key)} className="flex min-h-11 w-full cursor-pointer items-center gap-1 px-3 hover:text-offwhite">
                  {col.label}
                  {sortKey === col.key && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
                </button>
              </th>
            ))}
            <th className="px-3">Assigned</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id} onClick={() => onOpen(lead)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface/50">
              <td className="px-3 py-3 font-semibold">{lead.business_name}</td>
              <td className="px-3 py-3 text-muted">{lead.owner_name ?? '—'}</td>
              <td className="px-3 py-3"><StageBadge stage={lead.stage} /></td>
              <td className="px-3 py-3 text-muted">{packageLabel(lead.package_tier)}</td>
              <td className="px-3 py-3">{lead.deal_value !== null ? formatCurrency(lead.deal_value) : '—'}</td>
              <td className={`px-3 py-3 ${isOverdue(lead.next_action_date) ? 'font-semibold text-red-400' : 'text-muted'}`}>
                {lead.next_action_date ? dueLabel(lead.next_action_date) : '—'}
              </td>
              <td className="px-3 py-3 text-muted">{lead.last_contacted_at ? formatShortDate(lead.last_contacted_at) : 'Never'}</td>
              <td className="px-3 py-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple text-[10px] font-bold">{assignee(lead)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 9: Replace `src/pages/PipelineList.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Inbox, Plus } from 'lucide-react';
import { useLeads } from '../hooks/useLeads';
import { useProfiles } from '../hooks/useProfiles';
import { filterLeads, sortLeads } from '../lib/leadFilters';
import type { LeadFilters, SortKey } from '../lib/leadFilters';
import { STAGES } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { AddLeadWizard } from '../components/pipeline/AddLeadWizard';
import { FilterBar } from '../components/pipeline/FilterBar';
import { ListTable } from '../components/pipeline/ListTable';
import { LeadPanel } from '../components/pipeline/LeadPanel';
import { ViewToggle } from '../components/pipeline/ViewToggle';
import type { Lead, Stage } from '../types';

/** List pipeline view: search, filters, sortable table, side panel (SPEC.md §6). */
export function PipelineList() {
  const { leads, loading, error, createLead, updateLead } = useLeads();
  const { profiles } = useProfiles();
  const [searchParams] = useSearchParams();
  const urlStage = searchParams.get('stage');
  const initialStages = STAGES.some((s) => s.value === urlStage) ? [urlStage as Stage] : [];

  const [filters, setFilters] = useState<LeadFilters>({ search: '', stages: initialStages, assignees: [], overdueOnly: false });
  const [sortKey, setSortKey] = useState<SortKey>('business_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);

  useEffect(() => {
    if (selected) setSelected(leads.find((l) => l.id === selected.id) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads]);

  const visible = useMemo(
    () => sortLeads(filterLeads(leads, filters), sortKey, sortDir),
    [leads, filters, sortKey, sortDir],
  );

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Pipeline</h1>
        <div className="flex items-center gap-3">
          <ViewToggle current="list" />
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add lead
          </Button>
        </div>
      </div>

      <FilterBar filters={filters} onChange={setFilters} profiles={profiles.filter((p) => p.role === 'contractor')} />

      {loading && <Skeleton className="h-64 w-full" />}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {!loading && !error && visible.length === 0 && (
        <EmptyState
          icon={Inbox}
          title={leads.length === 0 ? 'No leads yet' : 'No leads match these filters'}
          hint={leads.length === 0 ? 'Add your first lead to start working the pipeline.' : 'Clear a filter or two and try again.'}
          action={leads.length === 0 ? <Button onClick={() => setWizardOpen(true)}>Add lead</Button> : undefined}
        />
      )}
      {!loading && !error && visible.length > 0 && (
        <ListTable leads={visible} profiles={profiles} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} onOpen={setSelected} />
      )}

      <AddLeadWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={createLead} />
      <LeadPanel lead={selected} profiles={profiles} onClose={() => setSelected(null)} onUpdate={updateLead} />
    </div>
  );
}
```

- [ ] **Step 10: Verify in browser**

1. `/pipeline/list` → table shows all leads; click "Company" header → sorts; click again → reverses (arrow flips).
2. Search for part of a business name → table narrows as you type.
3. Stage filter: pick "Contacted" → only contacted leads. Overdue-only toggle → only the overdue lead.
4. Row click → same panel as Kanban; edits reflect in the table immediately.
5. Visit `/pipeline/list?stage=won` directly → stage filter pre-set to Won.

- [ ] **Step 11: Commit**

```bash
git add src/components/ui/MultiSelect.tsx src/components/pipeline/FilterBar.tsx src/components/pipeline/ListTable.tsx src/pages/PipelineList.tsx
git commit -m "feat: pipeline list view with search, filters, sortable table, side panel"
```

---

### Task 13: Lead detail page

**Files:**
- Create: `src/components/pipeline/NotesTimeline.tsx`
- Create: `src/components/pipeline/LeadDetailSections.tsx`
- Modify: `src/pages/LeadDetailPage.tsx` (replace stub)

**Interfaces:**
- Consumes: `useLead`, `useLeadNotes`, `useProfiles`, `NextActionEditor`, `ContactInfo`/`PipelineInfo` (Task 11), `StageBadge`, `SelectField`, utils.
- Produces:
  - `NotesTimeline({ notes: LeadNote[], loading: boolean, authorName(id: string | null): string })` — chronological notes with a type icon per note. Reused visual language by Task 14's verification.
  - `NOTE_TYPE_ICONS: Record<NoteType, LucideIcon>` (exported from `NotesTimeline.tsx`).
  - Sections for email log / sequences / activity (in `LeadDetailSections.tsx`), querying the (currently empty) `email_logs` and `sequence_enrollments` tables with real empty states — cycle 2 fills them.

- [ ] **Step 1: Write `src/components/pipeline/NotesTimeline.tsx`**

```tsx
import { Mail, PhoneCall, Sparkles, StickyNote, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LeadNote, NoteType } from '../../types';
import { formatShortDate } from '../../lib/utils';
import { Skeleton } from '../ui/Skeleton';

/** Icon per note type — notes are icon + label, never colour-coded alone. */
export const NOTE_TYPE_ICONS: Record<NoteType, LucideIcon> = {
  call: PhoneCall,
  email: Mail,
  meeting: Users,
  general: StickyNote,
  ai_summary: Sparkles,
};

interface NotesTimelineProps {
  notes: LeadNote[];
  loading: boolean;
  authorName: (id: string | null) => string;
}

/** All notes for a lead, newest first, with author + timestamp + type icon. */
export function NotesTimeline({ notes, loading, authorName }: NotesTimelineProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (notes.length === 0) return <p className="text-sm text-muted">No notes yet — log your first call below.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {notes.map((note) => {
        const Icon = NOTE_TYPE_ICONS[note.note_type];
        return (
          <li key={note.id} className="flex gap-3 rounded-lg bg-surface/50 p-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-label={note.note_type} />
            <div className="min-w-0">
              <p className="whitespace-pre-wrap text-sm">{note.content}</p>
              <p className="mt-1 text-xs text-muted">
                {authorName(note.created_by)} · {formatShortDate(note.created_at)} · {note.note_type.replace('_', ' ')}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: Write `src/components/pipeline/LeadDetailSections.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { History, Mail, Repeat } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatShortDate } from '../../lib/utils';
import type { LeadNote } from '../../types';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';

interface EmailLogRow {
  id: string;
  subject: string;
  status: string;
  sent_at: string;
}

/** Emails sent to this lead (cycle 2 fills this — table exists and is queried for real). */
export function EmailLogSection({ leadId }: { leadId: string }) {
  const [rows, setRows] = useState<EmailLogRow[] | null>(null);
  useEffect(() => {
    void supabase
      .from('email_logs').select('id, subject, status, sent_at').eq('lead_id', leadId).order('sent_at', { ascending: false })
      .then(({ data }) => setRows((data as EmailLogRow[] | null) ?? []));
  }, [leadId]);

  if (rows === null) return <Skeleton className="h-16 w-full" />;
  if (rows.length === 0) {
    return <EmptyState icon={Mail} title="No emails yet" hint="Email drafting and sending arrives with the Email Automation module (cycle 2)." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between rounded-lg bg-surface/50 p-3 text-sm">
          <span className="truncate font-semibold">{r.subject}</span>
          <span className="shrink-0 text-xs text-muted">{r.status} · {formatShortDate(r.sent_at)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Active sequence enrollments (cycle 2 feature — empty state until then). */
export function SequencesSection({ leadId }: { leadId: string }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void supabase
      .from('sequence_enrollments').select('id', { count: 'exact', head: true }).eq('lead_id', leadId)
      .then(({ count: c }) => setCount(c ?? 0));
  }, [leadId]);

  if (count === null) return <Skeleton className="h-16 w-full" />;
  return <EmptyState icon={Repeat} title={count === 0 ? 'Not enrolled in any sequence' : `${count} enrollment(s)`} hint="Sequence enrollment arrives with the Email Automation module (cycle 2)." />;
}

/** Auto-logged stage changes, pulled from the notes stream. */
export function ActivityHistory({ notes, loading }: { notes: LeadNote[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-16 w-full" />;
  const changes = notes.filter((n) => n.note_type === 'general' && n.content.startsWith('Stage changed:'));
  if (changes.length === 0) return <p className="text-sm text-muted">No stage changes yet.</p>;
  return (
    <ol className="flex flex-col gap-1">
      {changes.map((n) => (
        <li key={n.id} className="flex items-center gap-2 text-sm text-muted">
          <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {n.content} · {formatShortDate(n.created_at)}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: Replace `src/pages/LeadDetailPage.tsx`**

```tsx
import { useParams } from 'react-router';
import { FileQuestion, MapPin } from 'lucide-react';
import { useLead } from '../hooks/useLead';
import { useLeadNotes } from '../hooks/useLeadNotes';
import { useProfiles } from '../hooks/useProfiles';
import { STAGES, formatCurrency, initials } from '../lib/utils';
import type { Stage } from '../types';
import { Card } from '../components/ui/Card';
import { SelectField } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { StageBadge } from '../components/pipeline/StageBadge';
import { NextActionEditor } from '../components/pipeline/NextActionEditor';
import { ContactInfo, PipelineInfo } from '../components/pipeline/LeadPanelSections';
import { NotesTimeline } from '../components/pipeline/NotesTimeline';
import { ActivityHistory, EmailLogSection, SequencesSection } from '../components/pipeline/LeadDetailSections';

/** Full lead record (SPEC.md §6 "Lead Detail Page") — 8 sections, vertical scroll. */
export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { lead, loading, error, updateLead } = useLead(id ?? 'none');
  const { notes, loading: notesLoading } = useLeadNotes(id ?? 'none');
  const { profiles } = useProfiles();

  function authorName(userId: string | null): string {
    const p = profiles.find((x) => x.id === userId);
    return p?.full_name ?? p?.email ?? 'Teammate';
  }

  if (loading) return <Skeleton className="h-80 w-full max-w-3xl" />;
  if (error || !lead) {
    return <EmptyState icon={FileQuestion} title="Lead not found" hint="It may have been removed, or you may not have access to it." />;
  }

  const assignedProfile = profiles.find((p) => p.id === lead.assigned_to);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-24 md:pb-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] font-extrabold">{lead.business_name}</h1>
        <StageBadge stage={lead.stage} />
        {assignedProfile && (
          <span title={assignedProfile.full_name ?? assignedProfile.email} className="flex h-8 w-8 items-center justify-center rounded-full bg-purple text-xs font-bold">
            {initials(assignedProfile.full_name ?? assignedProfile.email)}
          </span>
        )}
        {lead.deal_value !== null && <span className="ml-auto font-heading text-[22px] font-bold text-cyan">{formatCurrency(lead.deal_value)}</span>}
      </header>

      {(lead.address || lead.city || lead.postcode) && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <MapPin className="h-4 w-4" aria-hidden />
          {[lead.address, lead.city, lead.postcode].filter(Boolean).join(', ')}
        </p>
      )}

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Contact</h2>
        <ContactInfo lead={lead} />
      </Card>

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Pipeline</h2>
        <div className="mb-3">
          <SelectField label="Stage" value={lead.stage} onChange={(e) => void updateLead({ stage: e.target.value as Stage })}>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </SelectField>
        </div>
        <PipelineInfo lead={lead} />
      </Card>

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Next action</h2>
        <NextActionEditor lead={lead} onSave={(patch) => updateLead(patch)} />
      </Card>

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Notes</h2>
        <NotesTimeline notes={notes} loading={notesLoading} authorName={authorName} />
      </Card>

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Emails</h2>
        <EmailLogSection leadId={lead.id} />
      </Card>

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Sequences</h2>
        <SequencesSection leadId={lead.id} />
      </Card>

      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Activity</h2>
        <ActivityHistory notes={notes} loading={notesLoading} />
      </Card>
    </div>
  );
}
```

(The "Add note" button/FAB lands in Task 14 alongside the NoteComposer.)

- [ ] **Step 4: Verify in browser**

1. From Kanban, open a lead's panel → "Open full record" → all 7 cards render (Contact, Pipeline, Next action, Notes, Emails, Sequences, Activity).
2. The stage-change notes from earlier dragging appear under both Notes and Activity.
3. Change stage from the detail page dropdown → StageBadge in the header updates; a new Activity row appears after refresh.
4. Emails + Sequences show their cycle-2 empty states.
5. Open a nonsense URL `/pipeline/leads/00000000-0000-0000-0000-000000000000` → "Lead not found" empty state (RLS/single() error handled).
6. Narrow to mobile width → sections stack cleanly, phone renders as a tappable `tel:` link.

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/NotesTimeline.tsx src/components/pipeline/LeadDetailSections.tsx src/pages/LeadDetailPage.tsx
git commit -m "feat: full lead detail page with notes timeline, activity, cycle-2 placeholders"
```

---

### Task 14: Note logging — free text + structured debrief + next-action prompt

**Files:**
- Create: `src/components/pipeline/DebriefWizard.tsx`
- Create: `src/components/pipeline/NoteComposer.tsx`
- Modify: `src/components/pipeline/LeadPanel.tsx` (add "Log note" button)
- Modify: `src/pages/LeadDetailPage.tsx` (add "Add note" button + mobile FAB)

**Interfaces:**
- Consumes: `useLeadNotes.addNote`, `LeadPatch` updates, `Modal`, `StepProgress`, `Textarea`, `SelectField`, `Button`.
- Produces:
  - `NoteComposer({ open: boolean, onClose(), lead: Lead, addNote(content: string, noteType: NoteType): Promise<string | null>, onUpdateLead(patch: LeadPatch): Promise<string | null> })`
  - `DebriefWizard({ onSubmit(compiled: string, nextAction: { date: string | null; note: string | null }): void, onCancel() })`
- Spec deviations recorded: the "Let AI update this lead" toggle renders **disabled** with a "cycle 2" caption — `parse-notes` (Gemini) ships with the scraper/email cycle. Everything else per SPEC.md §6 "Note Input — Structured Debrief".

- [ ] **Step 1: Write `src/components/pipeline/DebriefWizard.tsx`**

One question per screen (ADHD rule), StepProgress + Back always visible.

```tsx
import { useState } from 'react';
import { Frown, Meh, Smile } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { StepProgress } from '../ui/StepProgress';

interface DebriefWizardProps {
  onSubmit: (compiled: string, nextAction: { date: string | null; note: string | null }) => void;
  onCancel: () => void;
}

const TOTAL = 6;
const OUTCOMES = [
  { value: 'Positive', icon: Smile },
  { value: 'Neutral', icon: Meh },
  { value: 'Negative', icon: Frown },
] as const;

/** Guided call debrief: 6 questions, one per screen, compiled into a single note. */
export function DebriefWizard({ onSubmit, onCancel }: DebriefWizardProps) {
  const [step, setStep] = useState(1);
  const [outcome, setOutcome] = useState('');
  const [pain, setPain] = useState('');
  const [objections, setObjections] = useState('');
  const [promise, setPromise] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [nextNote, setNextNote] = useState('');
  const [other, setOther] = useState('');

  function submit() {
    const compiled = [
      `Call outcome: ${outcome || 'Not recorded'}`,
      pain && `Main pain point:\n${pain}`,
      objections && `Objections:\n${objections}`,
      promise && `Promised follow-up:\n${promise}`,
      (nextDate || nextNote) && `Next step${nextDate ? ` (${nextDate})` : ''}:\n${nextNote || '—'}`,
      other && `Other notes:\n${other}`,
    ].filter(Boolean).join('\n\n');
    onSubmit(compiled, { date: nextDate || null, note: nextNote || null });
  }

  return (
    <div className="flex flex-col gap-5">
      <StepProgress step={step} total={TOTAL} />

      {step === 1 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">How did the call go?</legend>
          <div className="flex gap-2">
            {OUTCOMES.map(({ value, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => { setOutcome(value); setStep(2); }}
                aria-pressed={outcome === value}
                className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm font-semibold ${outcome === value ? 'border-cyan text-cyan' : 'border-line text-muted hover:text-offwhite'}`}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {value}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {step === 2 && <Textarea label="What was their main pain point?" value={pain} onChange={(e) => setPain(e.target.value)} placeholder="e.g. Losing leads because nobody follows up after quotes" />}
      {step === 3 && <Textarea label="Did they raise any objections?" value={objections} onChange={(e) => setObjections(e.target.value)} placeholder="e.g. Worried about cost; already tried an agency" />}
      {step === 4 && <Textarea label="What did you promise to follow up with?" value={promise} onChange={(e) => setPromise(e.target.value)} placeholder="e.g. Send the audit booking link by Friday" />}
      {step === 5 && (
        <div className="flex flex-col gap-3">
          <Input label="When is the next step?" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          <Input label="What is the next step?" value={nextNote} onChange={(e) => setNextNote(e.target.value)} placeholder="e.g. Call back to book the audit" />
        </div>
      )}
      {step === 6 && <Textarea label="Add any other notes (optional)" value={other} onChange={(e) => setOther(e.target.value)} />}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => (step === 1 ? onCancel() : setStep(step - 1))}>
          {step === 1 ? 'Cancel' : 'Back'}
        </Button>
        {step > 1 && step < TOTAL && <Button onClick={() => setStep(step + 1)}>Next</Button>}
        {step === TOTAL && <Button onClick={submit}>Save debrief</Button>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/pipeline/NoteComposer.tsx`**

```tsx
import { useState } from 'react';
import type { LeadPatch } from '../../lib/leadUpdates';
import type { Lead, NoteType } from '../../types';
import { Button } from '../ui/Button';
import { Input, SelectField, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { DebriefWizard } from './DebriefWizard';

interface NoteComposerProps {
  open: boolean;
  onClose: () => void;
  lead: Lead;
  addNote: (content: string, noteType: NoteType) => Promise<string | null>;
  onUpdateLead: (patch: LeadPatch) => Promise<string | null>;
}

type Phase = 'compose' | 'next-action';

/** Log-note dialog: guided debrief OR free text, then a "set your next action" prompt. */
export function NoteComposer({ open, onClose, lead, addNote, onUpdateLead }: NoteComposerProps) {
  const [tab, setTab] = useState<'debrief' | 'free'>('debrief');
  const [phase, setPhase] = useState<Phase>('compose');
  const [freeText, setFreeText] = useState('');
  const [noteType, setNoteType] = useState<NoteType>('call');
  const [nextDate, setNextDate] = useState('');
  const [nextNote, setNextNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setTab('debrief');
    setPhase('compose');
    setFreeText('');
    setNoteType('call');
    setNextDate('');
    setNextNote('');
    setError(null);
    onClose();
  }

  async function saveDebrief(compiled: string, nextAction: { date: string | null; note: string | null }) {
    setBusy(true);
    const err = await addNote(compiled, 'call');
    if (!err && (nextAction.date || nextAction.note)) {
      await onUpdateLead({ next_action_date: nextAction.date, next_action_note: nextAction.note });
    }
    setBusy(false);
    if (err) setError(err);
    else reset();
  }

  async function saveFreeText() {
    if (!freeText.trim()) return setError('Write a note first.');
    setBusy(true);
    const err = await addNote(freeText.trim(), noteType);
    setBusy(false);
    if (err) return setError(err);
    setNextDate(lead.next_action_date ?? '');
    setNextNote(lead.next_action_note ?? '');
    setPhase('next-action');
  }

  async function saveNextAction() {
    setBusy(true);
    const err = await onUpdateLead({ next_action_date: nextDate || null, next_action_note: nextNote || null });
    setBusy(false);
    if (err) setError(err);
    else reset();
  }

  return (
    <Modal open={open} onClose={reset} title={phase === 'compose' ? `Log note — ${lead.business_name}` : 'Set your next action'}>
      {phase === 'compose' ? (
        <div className="flex flex-col gap-4">
          <div className="flex overflow-hidden rounded-lg border border-line" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'debrief'} onClick={() => setTab('debrief')} className={`min-h-11 flex-1 cursor-pointer text-sm font-semibold ${tab === 'debrief' ? 'bg-violet/25' : 'text-muted'}`}>
              Quick debrief
            </button>
            <button type="button" role="tab" aria-selected={tab === 'free'} onClick={() => setTab('free')} className={`min-h-11 flex-1 cursor-pointer text-sm font-semibold ${tab === 'free' ? 'bg-violet/25' : 'text-muted'}`}>
              Free text
            </button>
          </div>

          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" disabled className="h-4 w-4" />
            Let AI update this lead from your notes — arrives in cycle 2
          </label>

          {tab === 'debrief' && <DebriefWizard onSubmit={(c, n) => void saveDebrief(c, n)} onCancel={reset} />}
          {tab === 'free' && (
            <div className="flex flex-col gap-4">
              <Textarea label="Session notes" value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder="Paste or type your notes here." rows={6} />
              <SelectField label="Note type" value={noteType} onChange={(e) => setNoteType(e.target.value as NoteType)}>
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="meeting">Meeting</option>
                <option value="general">General</option>
              </SelectField>
              {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
              <Button onClick={() => void saveFreeText()} disabled={busy}>{busy ? 'Saving…' : 'Save note'}</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">Note saved ✓ — before you close, when should you touch this lead next?</p>
          <Input label="Next action date" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          <Input label="Next action note" value={nextNote} onChange={(e) => setNextNote(e.target.value)} placeholder="e.g. Chase by phone" />
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={reset}>Skip</Button>
            <Button onClick={() => void saveNextAction()} disabled={busy}>{busy ? 'Saving…' : 'Save next action'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 3: Add "Log note" to `src/components/pipeline/LeadPanel.tsx`**

Changes to the existing file:

```tsx
// add imports
import { useState } from 'react';
import { NoteComposer } from './NoteComposer';

// inside LeadPanel, above the early return:
const [noteOpen, setNoteOpen] = useState(false);
const { notes, loading: notesLoading, addNote } = useLeadNotes(lead?.id ?? 'none'); // addNote now destructured

// in the action button block, ABOVE "Open full record" (Log note is the primary action):
<Button onClick={() => setNoteOpen(true)}>Log note</Button>

// after </aside>, still inside the outer div:
{lead && (
  <NoteComposer
    open={noteOpen}
    onClose={() => setNoteOpen(false)}
    lead={lead}
    addNote={addNote}
    onUpdateLead={(patch) => onUpdate(lead.id, patch)}
  />
)}
```

- [ ] **Step 4: Add "Add note" button + mobile FAB to `src/pages/LeadDetailPage.tsx`**

Changes to the existing file:

```tsx
// add imports
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { NoteComposer } from '../components/pipeline/NoteComposer';

// inside the component (lead is non-null past the guards):
const [noteOpen, setNoteOpen] = useState(false);
const { notes, loading: notesLoading, addNote, refresh: refreshNotes } = useLeadNotes(id ?? 'none');

// in the Notes card header, replace the plain <h2> with:
<div className="mb-2 flex items-center justify-between">
  <h2 className="text-[18px] font-bold">Notes</h2>
  <Button variant="secondary" onClick={() => setNoteOpen(true)}>Add note</Button>
</div>

// before the closing </div> of the page, add the FAB (mobile only) and the composer:
<button
  type="button"
  onClick={() => setNoteOpen(true)}
  aria-label="Add note"
  className="fixed bottom-20 right-4 z-40 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-violet shadow-lg md:hidden"
>
  <Plus className="h-6 w-6" aria-hidden />
</button>
<NoteComposer
  open={noteOpen}
  onClose={() => setNoteOpen(false)}
  lead={lead}
  addNote={addNote}
  onUpdateLead={(patch) => updateLead(patch)}
/>
```

- [ ] **Step 5: Verify in browser**

1. Lead detail → "Add note" → Quick debrief: answer all 6 screens (outcome buttons auto-advance; Back works) → Save debrief → compiled note appears in the timeline as a `call` note; next action date/note from step 5 are set on the lead; `call_count` incremented (Pipeline card shows "Calls made: 1").
2. "Add note" → Free text tab → type a note, type `meeting` → Save → the "Set your next action" prompt appears → Skip → note in timeline, no next-action change.
3. Free text again → this time save a next action for tomorrow → panel/detail show it.
4. Log note from the Kanban panel too → notes preview updates in place.
5. Mobile viewport: FAB visible bottom-right on lead detail; opens the same composer fullscreen-ish (modal max-height scroll).
6. AI toggle visible but disabled with the cycle-2 caption.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipeline/DebriefWizard.tsx src/components/pipeline/NoteComposer.tsx src/components/pipeline/LeadPanel.tsx src/pages/LeadDetailPage.tsx
git commit -m "feat: note logging - guided debrief wizard, free text, next-action prompt, mobile FAB"
```

---

### Task 15: Dashboard — Today's Focus

**Files:**
- Create: `src/hooks/useDashboardStats.ts`
- Create: `src/components/dashboard/StatsBar.tsx`
- Create: `src/components/dashboard/TodaysFocus.tsx`
- Create: `src/components/dashboard/EmailReviewQueue.tsx`
- Create: `src/components/dashboard/RecentlyActive.tsx`
- Create: `src/components/dashboard/PipelineSnapshot.tsx`
- Modify: `src/pages/Dashboard.tsx` (replace stub)

**Interfaces:**
- Consumes: `useLeads`, `useProfiles`, `LeadPanel`, `StageBadge`, `STAGE_BADGE_CLASSES`/`STAGE_ICONS`, utils.
- Produces:
  - `useDashboardStats(): { draftCount: number | null; callsThisWeek: number | null }` — `null` while loading. Draft count = `email_logs` rows with `status='draft'` (0 until cycle 2); calls this week = `lead_notes` of type `call` since Monday 00:00.
  - `TodaysFocus({ leads, onOpen })` — leads with `next_action_date` today or overdue; overdue first (oldest first), each card: company, stage badge, next-action note, `tel:` phone, due label.
  - `PipelineSnapshot({ leads })` — read-only stage counts, each chip links to `/pipeline/list?stage=<stage>`.

- [ ] **Step 1: Write `src/hooks/useDashboardStats.ts`**

```ts
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Monday 00:00 (local) of the current week, as an ISO string. */
function startOfWeekISO(now: Date = new Date()): string {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.toISOString();
}

/** Dashboard counters that need their own queries (drafts, calls this week). */
export function useDashboardStats() {
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [callsThisWeek, setCallsThisWeek] = useState<number | null>(null);

  useEffect(() => {
    void supabase
      .from('email_logs').select('id', { count: 'exact', head: true }).eq('status', 'draft')
      .then(({ count }) => setDraftCount(count ?? 0));
    void supabase
      .from('lead_notes').select('id', { count: 'exact', head: true })
      .eq('note_type', 'call').gte('created_at', startOfWeekISO())
      .then(({ count }) => setCallsThisWeek(count ?? 0));
  }, []);

  return { draftCount, callsThisWeek };
}
```

- [ ] **Step 2: Write StatsBar and TodaysFocus**

`src/components/dashboard/StatsBar.tsx`:

```tsx
import { CalendarClock, Kanban, MailCheck, PhoneCall } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isDueToday, isOverdue } from '../../lib/utils';
import type { Lead } from '../../types';
import { Card } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';

interface StatsBarProps {
  leads: Lead[];
  leadsLoading: boolean;
  draftCount: number | null;
  callsThisWeek: number | null;
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number | null }) {
  return (
    <Card className="flex flex-1 items-center gap-3">
      <Icon className="h-6 w-6 shrink-0 text-cyan" aria-hidden />
      <div>
        {value === null ? <Skeleton className="h-7 w-10" /> : <p className="font-heading text-[22px] font-bold">{value}</p>}
        <p className="text-xs font-semibold text-muted">{label}</p>
      </div>
    </Card>
  );
}

/** Four headline numbers (SPEC.md §8.2). */
export function StatsBar({ leads, leadsLoading, draftCount, callsThisWeek }: StatsBarProps) {
  const due = leads.filter((l) => isDueToday(l.next_action_date) || isOverdue(l.next_action_date)).length;
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Stat icon={Kanban} label="Leads in pipeline" value={leadsLoading ? null : leads.length} />
      <Stat icon={CalendarClock} label="Follow-ups due" value={leadsLoading ? null : due} />
      <Stat icon={MailCheck} label="Emails to review" value={draftCount} />
      <Stat icon={PhoneCall} label="Calls this week" value={callsThisWeek} />
    </div>
  );
}
```

`src/components/dashboard/TodaysFocus.tsx`:

```tsx
import { CheckCircle2, Phone } from 'lucide-react';
import { daysOverdue, dueLabel, isDueToday, isOverdue } from '../../lib/utils';
import type { Lead } from '../../types';
import { EmptyState } from '../ui/EmptyState';
import { StageBadge } from '../pipeline/StageBadge';

interface TodaysFocusProps {
  leads: Lead[];
  onOpen: (lead: Lead) => void;
}

/** The day's follow-ups: overdue first (oldest debt first), then today's. */
export function TodaysFocus({ leads, onOpen }: TodaysFocusProps) {
  const due = leads
    .filter((l) => isDueToday(l.next_action_date) || isOverdue(l.next_action_date))
    .sort((a, b) => daysOverdue(b.next_action_date!, new Date()) - daysOverdue(a.next_action_date!, new Date()));

  if (due.length === 0) {
    return <EmptyState icon={CheckCircle2} title="All caught up" hint="No follow-ups due today. Set next-action dates on your leads to fill this list." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {due.map((lead) => {
        const overdue = isOverdue(lead.next_action_date);
        return (
          <li key={lead.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpen(lead)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(lead); }}
              className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border p-3 hover:bg-surface/60 ${overdue ? 'border-red-500/40 bg-red-500/5' : 'border-line bg-card'}`}
            >
              <span className="font-heading text-sm font-bold">{lead.business_name}</span>
              <StageBadge stage={lead.stage} />
              <span className={`text-xs font-semibold ${overdue ? 'text-red-400' : 'text-cyan'}`}>
                {dueLabel(lead.next_action_date!)}
              </span>
              {lead.next_action_note && <span className="w-full text-sm text-muted sm:w-auto sm:flex-1">{lead.next_action_note}</span>}
              {lead.phone && (
                <a href={`tel:${lead.phone}`} onClick={(e) => e.stopPropagation()} className="ml-auto flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-cyan hover:bg-surface">
                  <Phone className="h-4 w-4" aria-hidden />
                  Call
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: Write EmailReviewQueue, RecentlyActive, PipelineSnapshot**

`src/components/dashboard/EmailReviewQueue.tsx`:

```tsx
import { MailCheck } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

/** Sequence drafts awaiting review — populated by the cycle-2 check-sequences cron. */
export function EmailReviewQueue({ draftCount }: { draftCount: number | null }) {
  if (draftCount === null) return null;
  return (
    <EmptyState
      icon={MailCheck}
      title={draftCount === 0 ? 'No emails waiting for review' : `${draftCount} draft(s) waiting`}
      hint="AI-drafted sequence emails will queue here for your approval once Email Automation lands (cycle 2)."
    />
  );
}
```

`src/components/dashboard/RecentlyActive.tsx`:

```tsx
import { formatShortDate } from '../../lib/utils';
import type { Lead } from '../../types';
import { StageBadge } from '../pipeline/StageBadge';

/** Last 5 touched leads — quick re-entry into live conversations. */
export function RecentlyActive({ leads, onOpen }: { leads: Lead[]; onOpen: (lead: Lead) => void }) {
  const recent = [...leads]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);
  if (recent.length === 0) return <p className="text-sm text-muted">Nothing here yet — activity shows up as you work leads.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {recent.map((lead) => (
        <li key={lead.id}>
          <button type="button" onClick={() => onOpen(lead)} className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left hover:bg-surface/60">
            <span className="flex-1 truncate text-sm font-semibold">{lead.business_name}</span>
            <StageBadge stage={lead.stage} />
            <span className="text-xs text-muted">{formatShortDate(lead.updated_at)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
```

`src/components/dashboard/PipelineSnapshot.tsx`:

```tsx
import { Link } from 'react-router';
import { STAGES } from '../../lib/utils';
import { STAGE_BADGE_CLASSES, STAGE_ICONS } from '../pipeline/stageStyles';
import type { Lead } from '../../types';

/** Read-only stage counts; each chip deep-links to the filtered list view. */
export function PipelineSnapshot({ leads }: { leads: Lead[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {STAGES.map((s) => {
        const Icon = STAGE_ICONS[s.value];
        const count = leads.filter((l) => l.stage === s.value).length;
        return (
          <Link
            key={s.value}
            to={`/pipeline/list?stage=${s.value}`}
            className={`flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold hover:opacity-80 ${STAGE_BADGE_CLASSES[s.value]}`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {s.label}
            <span className="rounded-full bg-black/25 px-2">{count}</span>
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Replace `src/pages/Dashboard.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useLeads } from '../hooks/useLeads';
import { useProfiles } from '../hooks/useProfiles';
import { useAuth } from '../hooks/useAuth';
import { useDashboardStats } from '../hooks/useDashboardStats';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { StatsBar } from '../components/dashboard/StatsBar';
import { TodaysFocus } from '../components/dashboard/TodaysFocus';
import { EmailReviewQueue } from '../components/dashboard/EmailReviewQueue';
import { RecentlyActive } from '../components/dashboard/RecentlyActive';
import { PipelineSnapshot } from '../components/dashboard/PipelineSnapshot';
import { LeadPanel } from '../components/pipeline/LeadPanel';
import type { Lead } from '../types';

function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Today's Focus dashboard (SPEC.md §8) — chunked, scannable, low cognitive load. */
export function Dashboard() {
  const { profile } = useAuth();
  const { leads, loading, error, updateLead } = useLeads();
  const { profiles } = useProfiles();
  const { draftCount, callsThisWeek } = useDashboardStats();
  const [selected, setSelected] = useState<Lead | null>(null);

  useEffect(() => {
    if (selected) setSelected(leads.find((l) => l.id === selected.id) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads]);

  const firstName = (profile?.full_name ?? profile?.email ?? '').split(' ')[0];
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[28px] font-extrabold">{greeting()}, {firstName}</h1>
        <p className="text-muted">{today}</p>
      </header>

      <StatsBar leads={leads} leadsLoading={loading} draftCount={draftCount} callsThisWeek={callsThisWeek} />

      <Card>
        <h2 className="mb-3 text-[18px] font-bold">Today's follow-ups</h2>
        {loading && <Skeleton className="h-24 w-full" />}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {!loading && !error && <TodaysFocus leads={leads} onOpen={setSelected} />}
      </Card>

      <Card>
        <h2 className="mb-3 text-[18px] font-bold">Emails ready to review</h2>
        <EmailReviewQueue draftCount={draftCount} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-[18px] font-bold">Recently active</h2>
          {loading ? <Skeleton className="h-24 w-full" /> : <RecentlyActive leads={leads} onOpen={setSelected} />}
        </Card>
        <Card>
          <h2 className="mb-3 text-[18px] font-bold">Pipeline snapshot</h2>
          {loading ? <Skeleton className="h-24 w-full" /> : <PipelineSnapshot leads={leads} />}
        </Card>
      </div>

      <LeadPanel lead={selected} profiles={profiles} onClose={() => setSelected(null)} onUpdate={updateLead} />
    </div>
  );
}
```

- [ ] **Step 5: Verify in browser**

1. `/` → greeting with your first name + today's date; 4 stat cards with real numbers (calls-this-week reflects your debrief notes from Task 14).
2. A lead with yesterday's next action shows in Today's follow-ups with a red border, ABOVE any due-today leads; "Call" is a `tel:` link.
3. Click a follow-up card → LeadPanel opens; complete the follow-up by logging a note + setting a future next action → card leaves the list.
4. Pipeline snapshot chips show correct counts; clicking "Won" lands on `/pipeline/list?stage=won` pre-filtered.
5. Recently active shows the leads you just touched, newest first.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useDashboardStats.ts src/components/dashboard src/pages/Dashboard.tsx
git commit -m "feat: Today's Focus dashboard - stats, follow-ups, review queue, snapshot"
```

---

### Task 16: Focus mode

**Files:**
- Create: `src/hooks/useFocusMode.tsx`
- Modify: `src/App.tsx` (mount provider)
- Modify: `src/components/layout/AppShell.tsx` (hide nav in focus mode)
- Modify: `src/components/layout/TopBar.tsx` (toggle button)
- Modify: `src/pages/Dashboard.tsx` (reduced layout in focus mode)

**Interfaces:**
- Produces: `FocusModeProvider({ children })`, `useFocusMode(): { focusMode: boolean; toggle(): void }` — persisted to `localStorage['focus-mode']`.

- [ ] **Step 1: Write `src/hooks/useFocusMode.tsx`**

```tsx
import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface FocusModeValue {
  focusMode: boolean;
  toggle: () => void;
}

const FocusModeContext = createContext<FocusModeValue | null>(null);

/** Focus mode strips the UI down to the day's essential tasks (ADHD rule 4). */
export function FocusModeProvider({ children }: { children: ReactNode }) {
  const [focusMode, setFocusMode] = useState(() => localStorage.getItem('focus-mode') === 'on');

  const toggle = useCallback(() => {
    setFocusMode((prev) => {
      localStorage.setItem('focus-mode', prev ? 'off' : 'on');
      return !prev;
    });
  }, []);

  return <FocusModeContext.Provider value={{ focusMode, toggle }}>{children}</FocusModeContext.Provider>;
}

/** Access focus mode state; must be used inside FocusModeProvider. */
export function useFocusMode(): FocusModeValue {
  const ctx = useContext(FocusModeContext);
  if (!ctx) throw new Error('useFocusMode must be used inside FocusModeProvider');
  return ctx;
}
```

- [ ] **Step 2: Wire it up**

`src/App.tsx` — wrap inside `AuthProvider`:

```tsx
import { FocusModeProvider } from './hooks/useFocusMode';
// ...
<AuthProvider>
  <FocusModeProvider>
    <Routes>…unchanged…</Routes>
  </FocusModeProvider>
</AuthProvider>
```

`src/components/layout/AppShell.tsx`:

```tsx
import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileNav } from './MobileNav';
import { useFocusMode } from '../../hooks/useFocusMode';

/** Main authenticated layout; focus mode hides all navigation chrome. */
export function AppShell() {
  const { focusMode } = useFocusMode();
  return (
    <div className="flex min-h-screen">
      {!focusMode && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 p-4 pb-20 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>
      {!focusMode && <MobileNav />}
    </div>
  );
}
```

`src/components/layout/TopBar.tsx` — add before the avatar `span`:

```tsx
// add imports
import { Focus } from 'lucide-react';
import { useFocusMode } from '../../hooks/useFocusMode';

// inside component
const { focusMode, toggle } = useFocusMode();

// first child of the <header>, pushed left with mr-auto:
<button
  type="button"
  onClick={toggle}
  aria-pressed={focusMode}
  className={`mr-auto flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-semibold ${focusMode ? 'bg-cyan/20 text-cyan' : 'text-muted hover:bg-surface hover:text-offwhite'}`}
>
  <Focus className="h-4 w-4" aria-hidden />
  {focusMode ? 'Exit focus' : 'Focus'}
</button>
```

`src/pages/Dashboard.tsx` — reduced layout. Add `const { focusMode } = useFocusMode();` (import from `../hooks/useFocusMode`) and wrap the non-essential sections:

```tsx
{!focusMode && <StatsBar … />}
// Today's follow-ups Card: always rendered
// Emails ready to review Card: always rendered
{!focusMode && (
  <div className="grid gap-6 lg:grid-cols-2">…RecentlyActive/PipelineSnapshot cards…</div>
)}
```

- [ ] **Step 3: Verify in browser**

1. Click "Focus" in the top bar → sidebar + mobile nav disappear; dashboard shows only Today's follow-ups + Emails ready to review; button reads "Exit focus".
2. Refresh → focus mode persists (localStorage).
3. Exit focus → everything returns.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useFocusMode.tsx src/App.tsx src/components/layout/AppShell.tsx src/components/layout/TopBar.tsx src/pages/Dashboard.tsx
git commit -m "feat: focus mode - strips nav and dashboard to the day's essential tasks"
```

---

### Task 17: Cycle-1 verification, RLS audit, docs, push

**Files:**
- Modify: `CLAUDE.md` (Current Status + Key Files sections)

- [ ] **Step 1: Full automated pass**

```bash
npm test        # expected: all utils + leadFilters tests pass
npm run build   # expected: tsc clean, vite build succeeds
```

- [ ] **Step 2: RLS + role-security audit (the DB is the boundary — verify it)**

With two accounts (Kevin admin + the invited test contractor):

1. As contractor: create a lead. As Kevin: it's visible (admin sees all).
2. As Kevin: create a lead, leave it unassigned. As contractor: it is NOT visible in pipeline, list, or dashboard.
3. As Kevin: assign that lead to the contractor via the panel. As contractor (refresh): now visible.
4. As contractor, in the browser devtools console on the app page, attempt privilege escalation — expected: **error or 0 rows updated**, and the role stays `contractor` after refresh:

```js
// run in the app's console (uses the app's own supabase client via a fresh import)
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
const c = createClient(localStorage.getItem('sb-url') ?? import.meta.env?.VITE_SUPABASE_URL ?? prompt('supabase url'), prompt('anon key'));
// sign in as the contractor, then:
await c.from('profiles').update({ role: 'admin' }).eq('id', (await c.auth.getUser()).data.user.id);
```

Simpler equivalent: temporarily paste `await supabase.from('profiles').update({ role: 'admin' }).eq('id', session.user.id)` into a component effect while signed in as contractor, observe the error, then remove it. Either way, confirm in Supabase Table Editor that `role` is still `contractor`.

5. As contractor: direct-visit `/admin` → redirected to `/`; `supabase.from('profiles').select('*')` returns only their own row.

- [ ] **Step 3: Accessibility + responsive spot checks**

1. DevTools → Rendering → emulate `prefers-reduced-motion: reduce` → skeletons stop pulsing, transitions stop (everything is behind `motion-safe:`/`motion-reduce:`).
2. Keyboard-only: tab through the Kanban page — cards focus and open with Enter; modal closes with Escape.
3. iPhone-size viewport: dashboard, list view, and lead detail are usable; Kanban page shows the desktop redirect message; FAB reachable.
4. Zoom to 200% — no clipped text or overlapping controls on the dashboard.

- [ ] **Step 4: Update CLAUDE.md**

Replace the **Current Status** section with reality:

```markdown
## Current Status
**Working:** Auth (invite-only, admin/contractor roles, RLS-enforced), app shell + routing, full pipeline
(Kanban drag-and-drop, list view with search/filter/sort, lead detail, expanded side panel), note logging
(guided debrief + free text + next-action prompt), Today's Focus dashboard, focus mode, admin panel
(invite, roles, lead assignment).
**In progress:** Nothing — cycle 1 complete.
**Not yet started:** Email automation (cycle 2), lead scraper (cycle 2/3), analytics, Cloudflare Pages deploy.
**Known issues:** Kanban reordering *within* a column is deferred (cross-column drag only). AI note parsing
toggle is visible but disabled until parse-notes ships. gemini-1.5-flash in SPEC.md is deprecated — use
gemini-2.5-flash when building cycle 2 (recorded in the design doc).
```

Fill in the **Key Files** table rows for the files that now exist (`src/lib/supabase.ts`, `src/types/index.ts`, `src/hooks/useAuth.ts→.tsx`, `supabase/migrations/001_initial_schema.sql`, `src/lib/utils.ts`, plus `src/lib/leadUpdates.ts` and `src/hooks/useLeads.ts` as new rows).

- [ ] **Step 5: Commit and push**

```bash
git add CLAUDE.md
git commit -m "chore: update CLAUDE.md - cycle 1 complete"
git push
```

Expected: everything on GitHub `main`. Cycle 1 done — cycle 2 (Email Automation) starts with its own brainstorm → spec → plan.

---

## Self-Review Notes (already applied)

- **Spec coverage:** Phases 1–3 of SPEC.md §14 all map to tasks (Phase 1 → Tasks 1–7; Phase 2 → Tasks 8–14; Phase 3 → Tasks 15–16; verification → Task 17). Deliberate cycle-1 deferrals recorded in-line: within-column Kanban reordering, AI note parsing, deactivate-account (schema has no `is_active` column — needs a cycle-2 migration), email/scraper/analytics modules.
- **Consistency:** `useLeadNotes` is defined once (Task 11) and consumed by Tasks 13–14; `applyLeadUpdate` is the single stage-mutation path; `ViewToggle`, `LeadPanel`, `NextActionEditor`, `StageBadge` each defined once and reused.
- **Types:** `LeadPatch`/`LeadInput`/`SortKey`/`LeadFilters` signatures match across tasks.
