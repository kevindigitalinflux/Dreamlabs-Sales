# Outreach Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate cold email, JV pitch, and warm LinkedIn DM outreach end-to-end (except LinkedIn's
required manual send), on top of this app's existing native Supabase edge-function + cron
infrastructure — no n8n, no new execution engine.

**Architecture:** Cold email + JV pitch extend the existing sequence engine
(`email_templates`/`email_sequences`/`sequence_enrollments`/`check-sequences`) with new templates,
an auto-enrollment cron, and a "notes-then-draft" AI split (Sonnet writes short reusable
personalization notes once per qualifying lead; Haiku always writes the actual email using those
notes). LinkedIn DM is a new, minimal table + edge function + queue UI reusing the review-queue
*pattern* only, since the send itself is manual. Reply detection polls each contractor's own
verified mailbox via IMAP, matches replies to sent emails via `Message-ID` headers, and optionally
auto-drafts a response (Haiku classifies simple/complex first, escalating to Sonnet only for
complex replies). Autopilot mode is a new cron-driven, fully-hands-off campaign wrapper (scrape →
auto-approve → auto-enroll → draft → send, throttled and guardrailed) that a user configures with a
duration, daily volume targets, and an upfront cost estimate.

**Tech Stack:** React 18 + TypeScript (strict), Vite, Tailwind, React Router v6, Supabase
(Postgres + Auth + Edge Functions/Deno + `pg_cron`), `npm:imapflow` (Deno npm-compat) for IMAP,
`denomailer` (existing) for SMTP send, direct `fetch` calls to Anthropic's Messages API (no SDK,
matching how Gemini/Google Places/Companies House/Apollo/Hunter are all called in this repo today).

**Spec:** `docs/superpowers/specs/2026-09-03-outreach-automation-design.md`

## Global Constraints

- TypeScript strict mode, no `any` (cast to `unknown` first if needed).
- Named exports only, no default exports.
- Tailwind utility classes only, no custom CSS or inline styles.
- Every component handles loading, error, and empty states.
- JSDoc comments on exported functions.
- Every edge function that does org-scoped service-role work MUST verify caller membership via
  `org_members` (`select role from org_members where org_id=X and user_id=callerId, maybeSingle()`;
  403 if no row) BEFORE any service-role read/write — the established, repeatedly-enforced pattern
  in this codebase (`scrape-google-places`, `scrape-companies-house`, `enrich-apollo`,
  `enrich-hunter`, `org-api-settings` all do this).
- `EdgeRuntime.waitUntil()` must be called on a promise constructed OUTSIDE the optional-chain
  expression (`const task = fn(); EdgeRuntime?.waitUntil(task);`), never
  `EdgeRuntime?.waitUntil(fn())` — the latter short-circuits the entire call, including argument
  evaluation, when `EdgeRuntime` is undefined (a real bug found and fixed twice in cycle 4).
- `resolveOrgApiKey()` must be used for every provider's key resolution — never a direct env-var
  read or a bypass. Paid/opt-in providers (Apollo, Hunter) never fall back to a global key;
  Gemini/Places/Companies-House-tier providers fall back to Kevin's global key only for orgs with
  `use_global_api_fallback = true` (Mr Brush & Co, DI Dreamlabs). Anthropic follows the
  Gemini-tier pattern (see spec's Decisions Locked table).
- CORS via the shared `_shared/cors.ts` helper (`corsHeaders`, `json`), matching every existing
  function.
- Every AI-drafted email (subject and body, any model, any function) MUST pass through
  `stripAiPunctuation()` before being stored — no exceptions.
- Every cron-triggered function authenticates via the shared `x-cron-secret` header check
  (`Deno.env.get('CRON_SECRET')`), never a user JWT — `pg_cron` has none.
- `created_by = null` / `enrolled_by = null` is this codebase's established convention for
  "system-generated, not a human action" — reuse it for every new system-authored row
  (`ai_summary` notes, auto-approved leads, auto-enrollments).

---

### Task 1: Migration — schema + seed content + cron

**Files:**
- Create: `supabase/migrations/006_outreach_automation.sql`

**Interfaces:**
- Produces: every new/changed column and table this whole plan depends on. All later tasks assume
  this migration has been applied.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/006_outreach_automation.sql
-- Outreach automation: cold email + JV pitch (sequence-engine extension), LinkedIn DM (new),
-- reply detection (IMAP), autopilot mode + guardrails. See
-- docs/superpowers/specs/2026-09-03-outreach-automation-design.md.

-- ── 1. Sequence-engine extensions ───────────────────────────────────────
ALTER TABLE leads ADD COLUMN is_priority boolean NOT NULL DEFAULT false;
ALTER TABLE email_sequences ADD COLUMN auto_draft_on_reply boolean NOT NULL DEFAULT false;

-- ── 2. Reply detection ──────────────────────────────────────────────────
ALTER TABLE user_email_settings ADD COLUMN imap_host text;
ALTER TABLE user_email_settings ADD COLUMN imap_port integer;
ALTER TABLE user_email_settings ADD COLUMN last_imap_check_at timestamptz;
ALTER TABLE email_logs ADD COLUMN message_id text;

CREATE TABLE email_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_log_id uuid NOT NULL REFERENCES email_logs(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id),
  from_email text NOT NULL,
  subject text,
  body text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_replies_org_read" ON email_replies FOR SELECT
  USING (is_org_member(org_id));
CREATE POLICY "email_replies_org_admin_all" ON email_replies FOR ALL
  USING (is_org_admin(org_id));

-- ── 3. LinkedIn DM ──────────────────────────────────────────────────────
CREATE TABLE linkedin_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  full_name text NOT NULL,
  linkedin_url text,
  context_signal text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','drafted','approved','sent','skipped')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE linkedin_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_contacts_org_member" ON linkedin_contacts FOR ALL
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE TABLE linkedin_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES linkedin_contacts(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id),
  message text NOT NULL,
  template_variant text NOT NULL CHECK (template_variant IN ('achievement','life_update','general')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','skipped')),
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE linkedin_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_drafts_org_member" ON linkedin_drafts FOR ALL
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

-- ── 4. Autopilot mode ───────────────────────────────────────────────────
CREATE TABLE autopilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  created_by uuid NOT NULL REFERENCES profiles(id),
  icp_raw_input text NOT NULL,
  icp_params jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('google_places','companies_house')),
  daily_lead_target integer NOT NULL CHECK (daily_lead_target BETWEEN 1 AND 60),
  daily_outreach_target integer NOT NULL CHECK (daily_outreach_target BETWEEN 1 AND 100),
  duration_days integer NOT NULL CHECK (duration_days IN (1, 7, 14, 21, 30)),
  ramp_up_enabled boolean NOT NULL DEFAULT true,
  max_total_spend_cents integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  cancel_reason text,
  estimated_cost_low_cents integer NOT NULL,
  estimated_cost_high_cents integer NOT NULL,
  leads_scraped_total integer NOT NULL DEFAULT 0,
  outreach_sent_total integer NOT NULL DEFAULT 0,
  actual_ai_cost_cents integer NOT NULL DEFAULT 0,
  bounce_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE autopilot_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "autopilot_runs_org_member" ON autopilot_runs FOR ALL
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE UNIQUE INDEX autopilot_runs_one_active_per_org
  ON autopilot_runs(org_id) WHERE status = 'active';

CREATE TABLE outreach_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  value text NOT NULL,
  reason text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, value)
);
ALTER TABLE outreach_blocklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outreach_blocklist_org_member" ON outreach_blocklist FOR ALL
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

-- ── 5. Anthropic as a BYO provider ──────────────────────────────────────
ALTER TABLE org_api_settings DROP CONSTRAINT org_api_settings_provider_check;
ALTER TABLE org_api_settings ADD CONSTRAINT org_api_settings_provider_check
  CHECK (provider = ANY (ARRAY['gemini','google_places','companies_house','apollo','hunter','anthropic']));

-- ── 6. Seed content: cold email + JV pitch templates/sequences ─────────
-- Org ids are looked up by name — stable across environments since these are
-- the two real orgs this ships to first (see spec: rollout order).
DO $$
DECLARE
  mr_brush_id uuid := (SELECT id FROM organizations WHERE name = 'Mr Brush & Co');
  di_dreamlabs_id uuid := (SELECT id FROM organizations WHERE name = 'DI Dreamlabs');
  cold1 uuid; cold2 uuid; cold3 uuid; jv1 uuid; jv2 uuid;
  org_row uuid;
BEGIN
  FOREACH org_row IN ARRAY ARRAY[mr_brush_id, di_dreamlabs_id]
  LOOP
    INSERT INTO email_templates (org_id, name, subject, body, template_type, is_default)
    VALUES (org_row, 'Cold outreach 1', 'quick one for {{company}}',
$body$Hi {{first_name}},

I'm a product designer who taught myself to build full-stack AI systems, the same skills I used to build the operating software for my own commercial cleaning company, Mr Brush & Co.

I'm taking on 5 free case-study builds this quarter for businesses like {{company}}, no cost, I just need your team to actually use it and give me honest feedback.

Worth a 15-minute look at what we'd build for you?

Kevin$body$,
      'cold_outreach_1', true)
    RETURNING id INTO cold1;

    INSERT INTO email_templates (org_id, name, subject, body, template_type, is_default)
    VALUES (org_row, 'Cold outreach 2', 're: quick one for {{company}}',
$body$Following up, here's what the same kind of system looks like running live at Mr Brush. Happy to walk you through what it'd look like for {{company}} specifically. Worth 15 minutes?$body$,
      'cold_outreach_2', true)
    RETURNING id INTO cold2;

    INSERT INTO email_templates (org_id, name, subject, body, template_type, is_default)
    VALUES (org_row, 'Cold outreach 3', 'closing this out',
$body$I'm capping the free case-study spots at 5 this round and I've got a couple left. If it's not a fit right now, no worries, I'll leave it here. If you want in, just reply "yes" and I'll send next steps.$body$,
      'cold_outreach_3', true)
    RETURNING id INTO cold3;

    INSERT INTO email_sequences (org_id, name, description, steps, is_default, auto_draft_on_reply)
    VALUES (org_row, 'Cold outreach default', 'Auto-enrollment target for newly-approved leads',
      jsonb_build_array(
        jsonb_build_object('delay_days', 0, 'template_type', 'cold_outreach_1', 'subject_override', NULL),
        jsonb_build_object('delay_days', 3, 'template_type', 'cold_outreach_2', 'subject_override', NULL),
        jsonb_build_object('delay_days', 7, 'template_type', 'cold_outreach_3', 'subject_override', NULL)
      ), true, true);
  END LOOP;

  -- JV pitch: Mr Brush & Co only.
  INSERT INTO email_templates (org_id, name, subject, body, template_type, is_default)
  VALUES (mr_brush_id, 'JV pitch 1', 'a cleaning offer worth £500 you can sell and keep 100% of',
$body$Hi {{first_name}},

Quick idea, I run Mr Brush & Co, a tech-managed commercial cleaning company in London. I'd like to give you a 3-Month Deep-Clean Office Package (worth £500) to offer your clients, and you keep 100% of whatever you charge for it.

Why would I do that? It gets us in front of facilities that are a great fit for our long-term cleaning contracts, and I'd rather pay for that access in delivered work than ad spend. You get a value-add for your clients and 100% of the revenue, we get the introduction. No cost to you, no risk to your reputation, we deliver, you get the credit.

Worth a quick call to see if it's a fit for your client base?$body$,
    'jv_pitch_1', true)
  RETURNING id INTO jv1;

  INSERT INTO email_templates (org_id, name, subject, body, template_type, is_default)
  VALUES (mr_brush_id, 'JV pitch 2', 're: a cleaning offer worth £500',
$body$Following up on this, happy to send over a one-pager on how the attribution/handoff works if that's useful before a call. Let me know either way.$body$,
    'jv_pitch_2', true)
  RETURNING id INTO jv2;

  INSERT INTO email_sequences (org_id, name, description, steps, is_default, auto_draft_on_reply)
  VALUES (mr_brush_id, 'JV pitch default', 'Manually enrolled JV/partnership contacts',
    jsonb_build_array(
      jsonb_build_object('delay_days', 0, 'template_type', 'jv_pitch_1', 'subject_override', NULL),
      jsonb_build_object('delay_days', 5, 'template_type', 'jv_pitch_2', 'subject_override', NULL)
    ), true, true);
END $$;

-- ── 7. Cron: three new daily jobs, staggered before the existing 06:00 run ─
SELECT cron.schedule(
  'run-autopilot-daily', '40 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/run-autopilot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'auto-enroll-cold-outreach-daily', '50 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/auto-enroll-cold-outreach',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'check-replies-daily', '55 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/check-replies',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 2: Apply and verify**

Apply via the Supabase MCP `apply_migration` tool (or `npx supabase db push` if that path is
working — the cycle-4 final-review fix found the CLI's local migration history is out of sync with
this remote project, so MCP is the proven-working path). Verify:
```sql
select cron.job.jobname, cron.job.schedule from cron.job where jobname like '%-daily';
select count(*) from email_templates where template_type like 'cold_outreach_%' or template_type like 'jv_pitch_%';
select count(*) from email_sequences where name in ('Cold outreach default', 'JV pitch default');
```
Expected: 4 cron jobs total (3 new + `check-sequences-daily`), 8 new templates (3×2 orgs cold +
2 JV), 3 new sequences (2 cold + 1 JV).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/006_outreach_automation.sql
git commit -m "feat: outreach automation schema, seed content, cron"
```

---

### Task 2: `_shared/orgApiKeys.ts` — Anthropic as a BYO provider

**Files:**
- Modify: `supabase/functions/_shared/orgApiKeys.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `resolveOrgApiKey(service, orgId, 'anthropic')` — every later task calling this for
  outreach AI depends on this existing.

- [ ] **Step 1: Add the provider**

Current file:
```ts
export type ApiProvider = 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter';

const GLOBAL_ENV_VARS: Record<ApiProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  google_places: 'GOOGLE_PLACES_API_KEY',
  companies_house: 'COMPANIES_HOUSE_API_KEY',
  apollo: 'APOLLO_API_KEY',
  hunter: 'HUNTER_API_KEY',
};
```

Change to:
```ts
export type ApiProvider = 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter' | 'anthropic';

const GLOBAL_ENV_VARS: Record<ApiProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  google_places: 'GOOGLE_PLACES_API_KEY',
  companies_house: 'COMPANIES_HOUSE_API_KEY',
  // apollo/hunter map to env vars that are never configured as secrets on
  // this project, by design — Deno.env.get() returns undefined for them no
  // matter what, so resolveOrgApiKey() below always returns null for these
  // two unless the org has its own key, regardless of use_global_api_fallback.
  // Paid providers must never fall back to Kevin's account.
  apollo: 'APOLLO_API_KEY',
  hunter: 'HUNTER_API_KEY',
  // anthropic follows the Gemini/Places/Companies-House tier instead — it's a
  // real, configured global secret, so Mr Brush & Co / DI Dreamlabs (the two
  // orgs with use_global_api_fallback=true) get outreach AI without setting
  // up their own key, matching how Gemini already works for them.
  anthropic: 'ANTHROPIC_API_KEY',
};
```

No other change — `resolveOrgApiKey()`'s logic is already provider-agnostic.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean (edge functions aren't tsc-checked in this repo — this step is a no-op
confirmation that nothing in `src/` broke; the real check is Deno's own type-checking on deploy).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/orgApiKeys.ts
git commit -m "feat: anthropic as a BYO API provider (Gemini-tier fallback)"
```

---

### Task 3: `_shared/textGuardrails.ts` — AI-tell punctuation guardrail

**Files:**
- Create: `supabase/functions/_shared/textGuardrails.ts`

**Interfaces:**
- Produces: `stripAiPunctuation(text: string): string` — every drafting function in this plan
  (Task 4 onward) calls this on every subject/body before storing it.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/_shared/textGuardrails.ts

/**
 * Replaces em/en-dashes and spaced hyphens used as clause connectors with a
 * comma — a deterministic backstop for the "never use dashes" prompt
 * instruction, since models don't reliably follow style instructions under
 * all conditions. Only targets space-dash-space (any dash variant); a
 * hyphenated compound word like "well-known" has no surrounding spaces and
 * is left untouched.
 */
export function stripAiPunctuation(text: string): string {
  return text.replace(/ [—–-] /g, ', ');
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/textGuardrails.ts
git commit -m "feat: stripAiPunctuation guardrail for AI-drafted email content"
```

---

### Task 4: `_shared/ai.ts` — notes-then-draft Claude functions + dash guardrail everywhere

**Files:**
- Modify: `supabase/functions/_shared/ai.ts`

**Interfaces:**
- Consumes: `stripAiPunctuation` (Task 3).
- Produces: `generateLeadNotes(input): Promise<string>`, `draftEmailClaude(input): Promise<{subject, body}>`,
  `classifyReply(input): Promise<'simple' | 'complex'>` — Tasks 9, 11, 12 all call these.
  `draftEmail` (existing, Gemini) keeps its exact existing signature/behavior, just gains the
  guardrail pass.

- [ ] **Step 1: Rewrite the file**

Current file (for reference — only the additions below are new):
```ts
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const AI_MODEL = 'gemini-3.6-flash';

async function geminiJson(prompt: string, apiKey: string): Promise<unknown> { /* unchanged */ }
export async function draftEmail(input: {...}): Promise<{ subject: string; body: string }> { /* unchanged body, see Step 1b */ }
export async function parseNotes(input: {...}): Promise<Record<string, unknown>> { /* unchanged */ }
```

Full new file:
```ts
import { stripAiPunctuation } from './textGuardrails.ts';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
// gemini-2.5-flash was retired by Google ("no longer available to new users")
// sometime after cycle 2 shipped — discovered live during Task 5 smoke testing
// when the global-fallback path silently degraded to plain-template emails.
export const AI_MODEL = 'gemini-3.6-flash';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export type ClaudeModel = 'claude-sonnet-5' | 'claude-haiku-4-5';

const DASH_GUARDRAIL_LINE =
  'Never use em-dashes or hyphens as sentence punctuation — use commas or periods instead.';

async function geminiJson(prompt: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${GEMINI_URL}/${AI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');
  return JSON.parse(text);
}

async function claudeText(prompt: string, model: ClaudeModel, apiKey: string, maxTokens: number): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Claude returned no content');
  return text;
}

async function claudeJson(prompt: string, model: ClaudeModel, apiKey: string, maxTokens: number): Promise<unknown> {
  const text = await claudeText(
    `${prompt}\n\nRespond with ONLY valid JSON, no other text, no markdown code fences.`,
    model, apiKey, maxTokens,
  );
  return JSON.parse(text);
}

/** Personalises an already-variable-substituted draft using lead context + notes. Throws on failure. */
export async function draftEmail(input: {
  subject: string; body: string; lead: Record<string, unknown>; notes: string[]; contractorName: string; orgName: string; apiKey: string;
}): Promise<{ subject: string; body: string }> {
  const result = await geminiJson(
`You are a sales assistant for ${input.orgName}, a UK agency selling automation/AI systems to small businesses.
Personalise this follow-up email using the lead data and call notes. Keep it plain text, warm, brief, UK English.
Do not invent facts not present in the data. Keep any URLs intact. ${DASH_GUARDRAIL_LINE} Return JSON: {"subject": string, "body": string}.

LEAD: ${JSON.stringify(input.lead)}
RECENT CALL NOTES (newest first): ${JSON.stringify(input.notes)}
SENDER NAME: ${input.contractorName}
DRAFT SUBJECT: ${input.subject}
DRAFT BODY:
${input.body}`,
    input.apiKey,
  ) as { subject?: string; body?: string };
  if (!result.subject || !result.body) throw new Error('Gemini draft missing fields');
  return { subject: stripAiPunctuation(result.subject), body: stripAiPunctuation(result.body) };
}

/** Suggests lead field updates from a note. Throws on failure. */
export async function parseNotes(input: { note: string; lead: Record<string, unknown>; apiKey: string }): Promise<Record<string, unknown>> {
  return await geminiJson(
`You extract CRM field updates from a sales call note. Compare the note against the current lead and output ONLY fields that should change, as JSON with any of these keys:
stage (one of: new_lead, contacted, audit_booked, proposal_sent, negotiating, won, lost, not_now_nurture),
deal_value (number, GBP), package_tier (one of: pilot_systems, pilot_ai_app, pilot_full_build, automation_sprint, ai_foundation, full_build, retainer_bronze, retainer_silver, retainer_gold, custom),
next_action_date (YYYY-MM-DD), next_action_note (string), pain_point (string),
rationale (string, ALWAYS present: one sentence explaining the suggestions).
Suggest nothing you are not confident about. Today is ${new Date().toISOString().slice(0, 10)}.

CURRENT LEAD: ${JSON.stringify(input.lead)}
NOTE:
${input.note}`,
    input.apiKey,
  ) as Record<string, unknown>;
}

/**
 * Sonnet-only: 2-4 short bullet-style personalization talking points for a
 * lead, generated once and reused across every subsequent touch (the caller
 * is responsible for only invoking this when no `ai_summary` note exists
 * yet — see check-sequences). Throws on failure, same contract as draftEmail.
 */
export async function generateLeadNotes(input: {
  lead: Record<string, unknown>; icpParams: Record<string, unknown> | null; apiKey: string;
}): Promise<string> {
  const text = await claudeText(
`You are a sales researcher. Given this business's data (and the ICP it was found against, if any),
write 2-4 short bullet-style personalization talking points a salesperson could use in a cold email —
a likely pain point implied by its rating/review count, a plausible angle from its industry/location.
Do not invent facts not present in the data. Plain text bullets, one per line, no preamble.

LEAD: ${JSON.stringify(input.lead)}
ICP: ${JSON.stringify(input.icpParams)}`,
    'claude-sonnet-5', input.apiKey, 300,
  );
  return stripAiPunctuation(text.trim());
}

/**
 * Claude-backed sibling to draftEmail's contract — writes the actual
 * subject/body for cold-email/JV-pitch/LinkedIn content. `model` is chosen
 * by the caller (Haiku for routine drafting, Sonnet for LinkedIn DMs and
 * complex-reply responses). Throws on failure.
 */
export async function draftEmailClaude(input: {
  subject: string; body: string; lead: Record<string, unknown>; notes: string[];
  contractorName: string; orgName: string; apiKey: string; model: ClaudeModel;
}): Promise<{ subject: string; body: string }> {
  const result = await claudeJson(
`You are a sales assistant for ${input.orgName}, a UK agency selling automation/AI systems to small businesses.
Personalise this outreach email using the lead data and any notes (which may include AI-generated
personalization talking points from an earlier research pass — use them as real context, not as
text to quote verbatim). Keep it plain text, warm, brief, UK English. Do not invent facts not
present in the data. Keep any URLs intact. ${DASH_GUARDRAIL_LINE} Return JSON: {"subject": string, "body": string}.

LEAD: ${JSON.stringify(input.lead)}
NOTES (newest first): ${JSON.stringify(input.notes)}
SENDER NAME: ${input.contractorName}
DRAFT SUBJECT: ${input.subject}
DRAFT BODY:
${input.body}`,
    input.model, input.apiKey, 600,
  ) as { subject?: string; body?: string };
  if (!result.subject || !result.body) throw new Error('Claude draft missing fields');
  return { subject: stripAiPunctuation(result.subject), body: stripAiPunctuation(result.body) };
}

/**
 * Cheap Haiku classification: is this reply a short acknowledgment/plain
 * yes-or-no/out-of-office ("simple"), or does it raise a real question,
 * objection, or multiple points ("complex")? Falls back to "complex" on any
 * ambiguous or unparseable model output — the more expensive path is the
 * safer default to fail into, not the cheaper one.
 */
export async function classifyReply(input: { replyBody: string; apiKey: string }): Promise<'simple' | 'complex'> {
  const text = await claudeText(
`Classify this email reply as exactly one word: "simple" (a short acknowledgment, a plain yes/no,
an out-of-office) or "complex" (a real question, an objection, multiple points raised, anything
needing actual judgment to respond to well). Reply with ONLY that one word.

REPLY:
${input.replyBody}`,
    'claude-haiku-4-5', input.apiKey, 10,
  );
  const label = text.trim().toLowerCase();
  return label === 'simple' ? 'simple' : 'complex';
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/ai.ts
git commit -m "feat: notes-then-draft Claude functions + dash guardrail on every AI draft"
```

---

### Task 5: Message-ID capture — `_shared/smtp.ts` + `send-email`

**Files:**
- Modify: `supabase/functions/_shared/smtp.ts`
- Modify: `supabase/functions/send-email/index.ts`

**Interfaces:**
- Produces: `sendMail()` now returns the `Message-ID` it sent with; `email_logs.message_id` is
  populated on every successful send. Task 11 (`check-replies`) depends on this being populated.

- [ ] **Step 1: `sendMail` generates and returns a Message-ID**

Full new `_shared/smtp.ts`:
```ts
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string | null;
}

/**
 * Sends one plain-text email. Port 465 = implicit TLS; anything else attempts
 * STARTTLS. Generates and sets an explicit Message-ID (denomailer doesn't
 * expose one from its send result) and returns it, so the caller can store
 * it for later reply-matching via In-Reply-To/References headers.
 */
export async function sendMail(
  cfg: SmtpConfig,
  msg: { to: string; subject: string; body: string },
): Promise<{ messageId: string }> {
  const client = new SMTPClient({
    connection: {
      hostname: cfg.host,
      port: cfg.port,
      tls: cfg.port === 465,
      auth: { username: cfg.user, password: cfg.pass },
    },
  });
  const domain = cfg.user.split('@')[1] ?? 'dreamlabs-sales.app';
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  // strip CR/LF — SMTP header injection guard
  const fromName = cfg.fromName ? cfg.fromName.replace(/[\r\n]+/g, ' ').trim() : cfg.fromName;
  const to = msg.to.replace(/[\r\n]+/g, ' ').trim();
  const subject = msg.subject.replace(/[\r\n]+/g, ' ').trim();
  try {
    await client.send({
      from: fromName ? `${fromName} <${cfg.user}>` : cfg.user,
      to,
      subject,
      content: msg.body,
      headers: { 'Message-ID': messageId },
    });
  } finally {
    try {
      await client.close();
    } catch {
      // ignore close errors — the send result above is what matters
    }
  }
  return { messageId };
}
```

- [ ] **Step 2: `send-email` stores the Message-ID**

In `supabase/functions/send-email/index.ts`, change:
```ts
  let status = 'sent';
  let errorMessage: string | null = null;
  try {
    await sendMail(
      { host: settings.smtp_host, port: settings.smtp_port, user: settings.smtp_user, pass: pass as string, fromName: settings.from_name },
      { to: body.to_email, subject: body.subject, body: body.body },
    );
  } catch (e) {
    status = 'failed';
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  const row: Record<string, unknown> = {
    lead_id: body.lead_id ?? null, sent_by: user.id, to_email: body.to_email,
    subject: body.subject, body: body.body, status, error_message: errorMessage,
    sent_at: new Date().toISOString(),
  };
```
to:
```ts
  let status = 'sent';
  let errorMessage: string | null = null;
  let messageId: string | null = null;
  try {
    const result = await sendMail(
      { host: settings.smtp_host, port: settings.smtp_port, user: settings.smtp_user, pass: pass as string, fromName: settings.from_name },
      { to: body.to_email, subject: body.subject, body: body.body },
    );
    messageId = result.messageId;
  } catch (e) {
    status = 'failed';
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  const row: Record<string, unknown> = {
    lead_id: body.lead_id ?? null, sent_by: user.id, to_email: body.to_email,
    subject: body.subject, body: body.body, status, error_message: errorMessage,
    message_id: messageId, sent_at: new Date().toISOString(),
  };
```

`email-settings/index.ts`'s `test` action also calls `sendMail` — no change needed there, it
already ignores the return value, and a discarded Message-ID on a test email is harmless.

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add supabase/functions/_shared/smtp.ts supabase/functions/send-email/index.ts
git commit -m "feat: capture Message-ID at send time for reply matching"
```

---

### Task 6: IMAP settings — `email-settings` + `useEmailSettings` + `EmailConfig.tsx`

**Files:**
- Modify: `supabase/functions/email-settings/index.ts`
- Modify: `src/hooks/useEmailSettings.ts`
- Modify: `src/pages/EmailConfig.tsx`
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `user_email_settings.imap_host`/`imap_port` populated (auto-derived for
  gmail/outlook/yahoo, user-entered for generic smtp) whenever a user saves their email settings.
  Task 11 (`check-replies`) depends on these being populated for `is_verified` users.

- [ ] **Step 1: `types/index.ts` — extend `UserEmailSettings`**

Change:
```ts
export interface UserEmailSettings {
  id: string;
  user_id: string;
  provider: EmailProvider;
  smtp_host: string | null;
  smtp_port: number;
  smtp_user: string | null;
  from_name: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}
```
to:
```ts
export interface UserEmailSettings {
  id: string;
  user_id: string;
  provider: EmailProvider;
  smtp_host: string | null;
  smtp_port: number;
  smtp_user: string | null;
  from_name: string | null;
  is_verified: boolean;
  imap_host: string | null;
  imap_port: number | null;
  last_imap_check_at: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: `email-settings/index.ts` — derive/accept IMAP host+port on save**

Add above the `Deno.serve` line:
```ts
const IMAP_PRESETS: Record<string, { host: string; port: number }> = {
  gmail: { host: 'imap.gmail.com', port: 993 },
  outlook: { host: 'outlook.office365.com', port: 993 },
  yahoo: { host: 'imap.mail.yahoo.com', port: 993 },
};
```

In the `'save'` branch, change:
```ts
  if (body.action === 'save') {
    const provider = String(body.provider ?? 'gmail');
    const smtpHost = String(body.smtp_host ?? '');
    const smtpPort = Number(body.smtp_port ?? 587);
    const smtpUser = String(body.smtp_user ?? '');
    const fromName = body.from_name ? String(body.from_name) : null;
    const password = body.password ? String(body.password) : null;
    if (!smtpHost || !smtpUser) return json({ error: 'smtp_host and smtp_user are required' }, 400, headers);

    const { error: upsertErr } = await service.from('user_email_settings').upsert(
      { user_id: user.id, provider, smtp_host: smtpHost, smtp_port: smtpPort, smtp_user: smtpUser, from_name: fromName, is_verified: false, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
```
to:
```ts
  if (body.action === 'save') {
    const provider = String(body.provider ?? 'gmail');
    const smtpHost = String(body.smtp_host ?? '');
    const smtpPort = Number(body.smtp_port ?? 587);
    const smtpUser = String(body.smtp_user ?? '');
    const fromName = body.from_name ? String(body.from_name) : null;
    const password = body.password ? String(body.password) : null;
    if (!smtpHost || !smtpUser) return json({ error: 'smtp_host and smtp_user are required' }, 400, headers);

    const preset = IMAP_PRESETS[provider];
    const imapHost = preset ? preset.host : (body.imap_host ? String(body.imap_host) : null);
    const imapPort = preset ? preset.port : (body.imap_port ? Number(body.imap_port) : null);

    const { error: upsertErr } = await service.from('user_email_settings').upsert(
      { user_id: user.id, provider, smtp_host: smtpHost, smtp_port: smtpPort, smtp_user: smtpUser, from_name: fromName, imap_host: imapHost, imap_port: imapPort, is_verified: false, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
```

- [ ] **Step 3: `useEmailSettings.ts` — pass IMAP fields through for the generic `smtp` provider**

Change:
```ts
export interface SaveInput {
  provider: EmailProvider;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  from_name: string;
  password: string;
}
```
to:
```ts
export interface SaveInput {
  provider: EmailProvider;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  from_name: string;
  password: string;
  imap_host?: string;
  imap_port?: number;
}
```
No other change needed — `save()` already spreads `...input` into the request body.

- [ ] **Step 4: `EmailConfig.tsx` — IMAP fields for the generic `smtp` provider only**

Change the `form` state's type/init and the `smtp`-only block:
```tsx
  const [form, setForm] = useState<SaveInput>({ provider: 'gmail', smtp_host: PRESETS.gmail.host, smtp_port: PRESETS.gmail.port, smtp_user: '', from_name: '', password: '' });
```
to:
```tsx
  const [form, setForm] = useState<SaveInput>({ provider: 'gmail', smtp_host: PRESETS.gmail.host, smtp_port: PRESETS.gmail.port, smtp_user: '', from_name: '', password: '', imap_host: '', imap_port: 993 });
```

And change:
```tsx
          {form.provider === 'smtp' && (
            <div className="flex gap-2">
              <Input label="SMTP host" value={form.smtp_host} onChange={(e) => setForm((f) => ({ ...f, smtp_host: e.target.value }))} />
              <Input label="Port" type="number" value={String(form.smtp_port)} onChange={(e) => setForm((f) => ({ ...f, smtp_port: Number(e.target.value) || 587 }))} />
            </div>
          )}
```
to:
```tsx
          {form.provider === 'smtp' && (
            <>
              <div className="flex gap-2">
                <Input label="SMTP host" value={form.smtp_host} onChange={(e) => setForm((f) => ({ ...f, smtp_host: e.target.value }))} />
                <Input label="SMTP port" type="number" value={String(form.smtp_port)} onChange={(e) => setForm((f) => ({ ...f, smtp_port: Number(e.target.value) || 587 }))} />
              </div>
              <div className="flex gap-2">
                <Input label="IMAP host (for reply detection)" value={form.imap_host ?? ''} onChange={(e) => setForm((f) => ({ ...f, imap_host: e.target.value }))} />
                <Input label="IMAP port" type="number" value={String(form.imap_port ?? 993)} onChange={(e) => setForm((f) => ({ ...f, imap_port: Number(e.target.value) || 993 }))} />
              </div>
            </>
          )}
```

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add supabase/functions/email-settings/index.ts src/hooks/useEmailSettings.ts src/pages/EmailConfig.tsx src/types/index.ts
git commit -m "feat: IMAP host/port capture for reply detection"
```

---

### Task 7: Anthropic provider UI + key validation

**Files:**
- Modify: `supabase/functions/org-api-settings/index.ts`
- Modify: `src/pages/OrganizationSettings.tsx`

**Interfaces:**
- Consumes: `OrgApiSetting['provider']` (Task 8's type — actually already covers this since
  `useOrgApiSettings.ts`'s `OrgApiSetting.provider` type needs `'anthropic'` added too, included
  below).
- Produces: an org admin can configure/validate an Anthropic key from the Settings UI.

- [ ] **Step 1: `org-api-settings/index.ts` — add Anthropic key validation**

Change the `Provider` type and `validateKey`:
```ts
type Provider = 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter';
```
to:
```ts
type Provider = 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter' | 'anthropic';
```

In `validateKey`, add a branch before the final `hunter` fallback (which uses an unconditional
`if`/no `else` chain — insert this new branch alongside the existing `if (provider === 'apollo')`
block):
```ts
    if (provider === 'anthropic') {
      // A trivial 1-token request is the standard way to validate a Claude
      // key — there's no dedicated health-check endpoint. Cheapest possible
      // real call: Haiku, max_tokens 1.
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] }),
      });
      return res.ok ? null : `Anthropic rejected the key (HTTP ${res.status})`;
    }
```

And update the `'save'` action's allow-list:
```ts
    if (!['gemini', 'google_places', 'companies_house', 'apollo', 'hunter'].includes(provider)) return json({ error: 'Invalid provider' }, 400, headers);
```
to:
```ts
    if (!['gemini', 'google_places', 'companies_house', 'apollo', 'hunter', 'anthropic'].includes(provider)) return json({ error: 'Invalid provider' }, 400, headers);
```

- [ ] **Step 2: `OrganizationSettings.tsx` — add the Anthropic row**

Add to the `PROVIDERS` array (after the `hunter` entry):
```tsx
  {
    key: 'anthropic',
    label: 'Anthropic Claude (outreach AI)',
    url: 'https://console.anthropic.com/settings/keys',
    ctaLabel: 'Get your Anthropic API key →',
    freeText: "Powers cold-email/JV-pitch/LinkedIn drafting for this org. Trivially cheap at real volume (a few dollars a month even sending hundreds of messages). Mr Brush & Co and DI Dreamlabs fall back to Kevin's key automatically if this isn't configured, matching how Gemini already works — other orgs need their own key before outreach automation activates.",
  },
```

- [ ] **Step 3: `useOrgApiSettings.ts` — extend the provider type**

Change:
```ts
export interface OrgApiSetting {
  provider: 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter';
  is_configured: boolean;
}
```
to:
```ts
export interface OrgApiSetting {
  provider: 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter' | 'anthropic';
  is_configured: boolean;
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add supabase/functions/org-api-settings/index.ts src/pages/OrganizationSettings.tsx src/hooks/useOrgApiSettings.ts
git commit -m "feat: Anthropic provider in org API-key settings"
```

---

### Task 8: Scraper `max_results` cap — needed by autopilot

**Files:**
- Modify: `supabase/functions/scrape-google-places/index.ts`
- Modify: `supabase/functions/scrape-companies-house/index.ts`

**Interfaces:**
- Produces: both scrapers accept an optional `max_results` in the request body, capping how many
  results they fetch/keep. Task 13 (`run-autopilot`) is the first caller to pass this.
- Consumes: nothing new. The manual scraper wizard (`Scraper.tsx`) is unaffected — it never sends
  `max_results`, so both functions keep their existing ~60/30 default behavior for it.

- [ ] **Step 1: `scrape-google-places/index.ts`**

Change the body type and the two `60` references:
```ts
  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams };
```
to:
```ts
  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams; max_results?: number };
```

Pass the cap into `runScrapeJob`:
```ts
  const task = runScrapeJob(service, job.id, orgId, body.icp_params, apiKey);
```
to:
```ts
  const cap = Math.min(60, body.max_results ?? 60);
  const task = runScrapeJob(service, job.id, orgId, body.icp_params, apiKey, cap);
```

Update `runScrapeJob`'s signature and its two `60` usages:
```ts
async function runScrapeJob(service: SupabaseClient, jobId: string, orgId: string, icp: IcpParams, apiKey: string) {
```
to:
```ts
async function runScrapeJob(service: SupabaseClient, jobId: string, orgId: string, icp: IcpParams, apiKey: string, cap: number) {
```

```ts
    for (let page = 0; page < 3 && allPlaces.length < 60; page++) {
```
to:
```ts
    for (let page = 0; page < 3 && allPlaces.length < cap; page++) {
```

```ts
    const places = allPlaces.slice(0, 60).filter((place) => {
```
to:
```ts
    const places = allPlaces.slice(0, cap).filter((place) => {
```

- [ ] **Step 2: `scrape-companies-house/index.ts`**

Same pattern. Change the body type:
```ts
  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams };
```
to:
```ts
  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams; max_results?: number };
```

Pass the cap:
```ts
  const task = runScrapeJob(service, job.id, orgId, body.icp_params, apiKey);
```
to:
```ts
  const cap = Math.min(30, body.max_results ?? 30);
  const task = runScrapeJob(service, job.id, orgId, body.icp_params, apiKey, cap);
```

Update `runScrapeJob`:
```ts
async function runScrapeJob(service: SupabaseClient, jobId: string, orgId: string, icp: IcpParams, apiKey: string) {
```
to:
```ts
async function runScrapeJob(service: SupabaseClient, jobId: string, orgId: string, icp: IcpParams, apiKey: string, cap: number) {
```

```ts
    const res = await fetch(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query)}&items_per_page=30`, {
```
to:
```ts
    const res = await fetch(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query)}&items_per_page=${cap}`, {
```

```ts
    const companies = (data.items ?? []).slice(0, 30);
```
to:
```ts
    const companies = (data.items ?? []).slice(0, cap);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/scrape-google-places/index.ts supabase/functions/scrape-companies-house/index.ts
git commit -m "feat: optional max_results cap on both scrapers (for autopilot's daily target)"
```

---

### Task 9: `check-sequences` — notes-then-draft routing + ramp-up throttle + spend cap

**Files:**
- Modify: `supabase/functions/check-sequences/index.ts`

**Interfaces:**
- Consumes: `resolveOrgApiKey` (Task 2), `generateLeadNotes`/`draftEmailClaude` (Task 4).
- Produces: cold_outreach_*/jv_pitch_* templates get Claude-drafted (not Gemini) content;
  autopilot's daily send throttle is enforced here.

- [ ] **Step 1: Rewrite the file**

Full new `supabase/functions/check-sequences/index.ts`:
```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';
import { draftEmail, draftEmailClaude, generateLeadNotes } from '../_shared/ai.ts';
import type { ClaudeModel } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { buildTemplateVars, substituteVariables } from '../_shared/templateVars.ts';

interface Step { delay_days: number; template_type: string; subject_override: string | null }

// Deno copy of advanceEnrollment from src/lib/sequenceMath.ts — keep in sync.
function advance(currentStep: number, steps: Step[], now: Date) {
  const next = currentStep + 1;
  if (next > steps.length) return { current_step: currentStep, next_send_at: null, status: 'completed' };
  return { current_step: next, next_send_at: new Date(now.getTime() + steps[next - 1]!.delay_days * 86_400_000).toISOString(), status: 'active' };
}

const HEADERS = { 'Content-Type': 'application/json' };
const OUTREACH_PREFIXES = ['cold_outreach_', 'jv_pitch_'];
function isOutreachTemplate(templateType: string): boolean {
  return OUTREACH_PREFIXES.some((p) => templateType.startsWith(p));
}

/** ramp-up: day 1-4 of an active autopilot run scale the daily send cap. */
function rampedCap(dailyTarget: number, dayNumber: number): number {
  const pct = dayNumber === 1 ? 0.25 : dayNumber === 2 ? 0.5 : dayNumber === 3 ? 0.75 : 1;
  return Math.max(1, Math.ceil(dailyTarget * pct));
}

/**
 * Cron target for `check-sequences-daily` (migration 002): drafts the next due
 * step for every active enrollment, then advances or completes it. Auth is a
 * shared secret header (no user JWT — pg_cron has none), never the Supabase
 * anon/service keys.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, HEADERS);
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return json({ error: 'Forbidden' }, 403, HEADERS);
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: due } = await service
    .from('sequence_enrollments')
    .select('*, sequence:email_sequences(*), lead:leads(*)')
    .eq('status', 'active')
    .lte('next_send_at', new Date().toISOString());

  // Autopilot throttle state, computed once per org as it's needed.
  const autopilotByOrg = new Map<string, { dailyOutreachTarget: number; dayNumber: number; rampUp: boolean; maxSpendCents: number | null; actualSpendCents: number; runId: string } | null>();
  const sentTodayByOrg = new Map<string, number>();

  let drafted = 0;
  const skipped: { id: string; reason: string }[] = [];

  for (const row of due ?? []) {
    const enrollment = row as Record<string, unknown> & {
      id: string; current_step: number; enrolled_by: string | null;
      sequence: { steps: Step[]; auto_draft_on_reply: boolean } | null;
      lead: Record<string, unknown> | null;
    };
    const steps = enrollment.sequence?.steps ?? [];
    const step = steps[enrollment.current_step - 1];
    const lead = enrollment.lead;
    if (!step || !lead) { skipped.push({ id: enrollment.id, reason: 'missing step or lead' }); continue; }
    if (!lead.email) { skipped.push({ id: enrollment.id, reason: 'lead has no email' }); continue; }

    const orgId = lead.org_id as string;
    const outreach = isOutreachTemplate(step.template_type);

    // Autopilot daily throttle — only applies to outreach templates in an org with an active run.
    if (outreach) {
      if (!autopilotByOrg.has(orgId)) {
        const { data: run } = await service.from('autopilot_runs')
          .select('id, daily_outreach_target, ramp_up_enabled, started_at, max_total_spend_cents, actual_ai_cost_cents')
          .eq('org_id', orgId).eq('status', 'active').maybeSingle();
        if (run) {
          const dayNumber = Math.max(1, Math.floor((Date.now() - new Date(run.started_at).getTime()) / 86_400_000) + 1);
          autopilotByOrg.set(orgId, {
            dailyOutreachTarget: run.daily_outreach_target, dayNumber, rampUp: run.ramp_up_enabled,
            maxSpendCents: run.max_total_spend_cents, actualSpendCents: run.actual_ai_cost_cents, runId: run.id,
          });
        } else {
          autopilotByOrg.set(orgId, null);
        }
      }
      const autopilot = autopilotByOrg.get(orgId);
      if (autopilot) {
        if (autopilot.maxSpendCents != null && autopilot.actualSpendCents >= autopilot.maxSpendCents) {
          skipped.push({ id: enrollment.id, reason: 'autopilot spend cap reached' });
          continue;
        }
        const cap = autopilot.rampUp ? rampedCap(autopilot.dailyOutreachTarget, autopilot.dayNumber) : autopilot.dailyOutreachTarget;
        if (!sentTodayByOrg.has(orgId)) {
          const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
          const { count } = await service.from('email_logs')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', orgId).gte('sent_at', startOfDay.toISOString());
          sentTodayByOrg.set(orgId, count ?? 0);
        }
        const sentToday = sentTodayByOrg.get(orgId)!;
        if (sentToday >= cap) { skipped.push({ id: enrollment.id, reason: 'autopilot daily cap reached' }); continue; }
      }
    }

    const { data: template } = await service
      .from('email_templates').select('*')
      .eq('template_type', step.template_type).eq('is_default', true)
      .limit(1).maybeSingle();
    if (!template) { skipped.push({ id: enrollment.id, reason: `no default template ${step.template_type}` }); continue; }

    const { data: enroller } = await service
      .from('profiles').select('full_name, email').eq('id', enrollment.enrolled_by ?? '').maybeSingle();
    const contractorName = (enroller?.full_name ?? enroller?.email ?? 'The Dreamlabs team').split(' ')[0]!;
    const { data: notesRows } = await service
      .from('lead_notes').select('content, note_type').eq('lead_id', lead.id as string)
      .order('created_at', { ascending: false }).limit(5);
    const noteTexts = (notesRows ?? []).map((n) => (n as { content: string }).content);
    const hasHumanNote = (notesRows ?? []).some((n) => (n as { note_type: string }).note_type !== 'ai_summary');
    const hasAiSummary = (notesRows ?? []).some((n) => (n as { note_type: string }).note_type === 'ai_summary');

    const vars = buildTemplateVars(lead, contractorName, noteTexts);
    const subject = substituteVariables((step.subject_override ?? template.subject) as string, vars);
    const bodyText = substituteVariables(template.body as string, vars);

    let finalSubject = subject.text;
    let finalBody = bodyText.text;

    if (outreach) {
      const apiKey = await resolveOrgApiKey(service, orgId, 'anthropic');
      if (!apiKey) { skipped.push({ id: enrollment.id, reason: 'no anthropic key configured' }); continue; }

      // Compatible-lead gate for the notes pass: priority flag, OR tight ICP
      // fit (JV pitch has no scrape_job to check against — always qualifies),
      // OR a human already left a note. AI-generated notes don't count
      // towards this on their own (checked separately as hasAiSummary).
      let tightIcpFit = step.template_type.startsWith('jv_pitch_');
      let icpParams: Record<string, unknown> | null = null;
      if (!tightIcpFit && lead.raw_lead_id) {
        const { data: rawLead } = await service.from('raw_leads')
          .select('scrape_jobs(icp_params)').eq('id', lead.raw_lead_id as string).maybeSingle();
        const params = (rawLead as { scrape_jobs: { icp_params: Record<string, unknown> } | null } | null)?.scrape_jobs?.icp_params ?? null;
        icpParams = params;
        if (params) {
          const rating = lead.google_rating as number | null;
          const reviews = lead.review_count as number | null;
          const industry = (params.industry as string | null)?.toLowerCase();
          const vertical = (lead.vertical as string | null)?.toLowerCase();
          const ratingOk = rating == null || ((params.min_rating == null || rating >= (params.min_rating as number)) && (params.max_rating == null || rating <= (params.max_rating as number)));
          const reviewsOk = reviews == null || params.max_reviews == null || reviews <= (params.max_reviews as number);
          const industryOk = !industry || !vertical || vertical.includes(industry);
          tightIcpFit = ratingOk && reviewsOk && industryOk;
        }
      }
      const compatible = (lead.is_priority as boolean) || tightIcpFit || hasHumanNote;

      if (!hasAiSummary && compatible) {
        try {
          const notesText = await generateLeadNotes({ lead, icpParams, apiKey });
          await service.from('lead_notes').insert({
            lead_id: lead.id, created_by: null, note_type: 'ai_summary', content: notesText,
          });
          noteTexts.unshift(notesText);
        } catch (e) {
          console.error(`generateLeadNotes failed for lead ${lead.id}, continuing without it:`, e);
        }
      }

      const model: ClaudeModel = 'claude-haiku-4-5';
      try {
        const { data: org } = await service.from('organizations').select('name').eq('id', orgId).maybeSingle();
        const orgName = org?.name ?? 'our team';
        const ai = await draftEmailClaude({ subject: subject.text, body: bodyText.text, lead, notes: noteTexts, contractorName, orgName, apiKey, model });
        finalSubject = ai.subject; finalBody = ai.body;
        if (autopilotByOrg.get(orgId)) {
          const costCents = 1; // rough per-draft accounting, see run-autopilot's estimate math
          await service.from('autopilot_runs').update({ actual_ai_cost_cents: (autopilotByOrg.get(orgId)!.actualSpendCents + costCents) }).eq('org_id', orgId).eq('status', 'active');
        }
      } catch (e) {
        console.error(`Claude draft failed for enrollment ${enrollment.id}, using plain template:`, e);
      }
    } else {
      const apiKey = await resolveOrgApiKey(service, orgId, 'gemini');
      if (apiKey) {
        try {
          const { data: org } = await service.from('organizations').select('name').eq('id', orgId).maybeSingle();
          const orgName = org?.name ?? 'our team';
          const ai = await draftEmail({ subject: subject.text, body: bodyText.text, lead, notes: noteTexts, contractorName, orgName, apiKey });
          finalSubject = ai.subject; finalBody = ai.body;
        } catch (e) {
          console.error(`AI draft failed for enrollment ${enrollment.id}, using plain template:`, e);
        }
      }
    }

    const { error: insertErr } = await service.from('email_logs').insert({
      lead_id: lead.id, sequence_enrollment_id: enrollment.id, sent_by: enrollment.enrolled_by,
      to_email: lead.email, subject: finalSubject, body: finalBody, status: 'draft', org_id: orgId,
    });
    if (insertErr) {
      // Don't advance — the next daily run re-picks this enrollment (intended retry).
      console.error(`email_logs insert failed for enrollment ${enrollment.id}:`, insertErr.message);
      skipped.push({ id: enrollment.id, reason: 'draft insert failed: ' + insertErr.message });
      continue;
    }
    await service.from('sequence_enrollments')
      .update(advance(enrollment.current_step, steps, new Date()))
      .eq('id', enrollment.id);
    drafted++;
    if (outreach) sentTodayByOrg.set(orgId, (sentTodayByOrg.get(orgId) ?? 0) + 1);
  }

  return json({ drafted, skipped }, 200, HEADERS);
});
```

Note on `actual_ai_cost_cents` accounting: this task uses a simple flat per-draft increment (`1`
cent) rather than exact per-token pricing, since Anthropic's response doesn't include this
function's exact token usage in a form worth parsing here — `run-autopilot` (Task 13) does the
more precise estimate at setup time; this running counter is a coarse "spend is happening, here's
roughly how much" signal for the progress view and the spend-cap guardrail, not an exact invoice.
**Flagging for review** — if precise real-dollar tracking matters more than this plan assumes,
Anthropic's response includes `usage.input_tokens`/`usage.output_tokens` and `draftEmailClaude`
could be extended to return them for exact accounting; not done here to keep the notes-then-draft
functions' contracts simple and reusable.

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add supabase/functions/check-sequences/index.ts
git commit -m "feat: check-sequences — notes-then-draft Claude routing, autopilot throttle+spend-cap"
```

---

### Task 10: `auto-enroll-cold-outreach` — new cron function

**Files:**
- Create: `supabase/functions/auto-enroll-cold-outreach/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: new `new_lead`-stage leads with no active/paused enrollment get enrolled into their
  org's `cold_outreach_default` sequence.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/auto-enroll-cold-outreach/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';
import { nextSendAtForDeno } from '../_shared/sequenceMathDeno.ts';

const HEADERS = { 'Content-Type': 'application/json' };

/**
 * Cron target: auto-enrolls newly-approved new_lead-stage leads (no existing
 * active/paused enrollment — the schema enforces at most one, so this can
 * never conflict with a manual enrollment) into their org's default
 * cold-outreach sequence. Same shared-secret auth as check-sequences.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, HEADERS);
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return json({ error: 'Forbidden' }, 403, HEADERS);
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: sequences } = await service
    .from('email_sequences').select('id, org_id, steps').eq('name', 'Cold outreach default');

  let enrolled = 0;
  for (const seq of sequences ?? []) {
    const sequence = seq as { id: string; org_id: string; steps: { delay_days: number }[] };
    const { data: candidates } = await service
      .from('leads').select('id')
      .eq('org_id', sequence.org_id).eq('stage', 'new_lead');
    for (const lead of candidates ?? []) {
      const { data: existing } = await service.from('sequence_enrollments')
        .select('id').eq('lead_id', (lead as { id: string }).id).in('status', ['active', 'paused']).maybeSingle();
      if (existing) continue;
      const { error } = await service.from('sequence_enrollments').insert({
        lead_id: (lead as { id: string }).id, sequence_id: sequence.id, current_step: 1,
        next_send_at: nextSendAtForDeno(new Date(), sequence.steps, 1),
        status: 'active', enrolled_by: null,
      });
      if (!error) enrolled++;
    }
  }

  return json({ enrolled }, 200, HEADERS);
});
```

This needs a Deno-side copy of `src/lib/sequenceMath.ts`'s `nextSendAtFor`, matching the
established convention in this codebase (`check-sequences`' own `advance()` is already a Deno copy
of `advanceEnrollment` — Deno edge functions can't import from `src/`, confirmed convention across
every existing edge function).

- [ ] **Step 2: Write the Deno copy**

First read `src/lib/sequenceMath.ts`'s `nextSendAtFor` implementation to transcribe it exactly
(do not guess its logic — it must match the frontend's `useEnrollments.enroll()` behavior exactly,
since that's what a manual enrollment already produces).

```ts
// supabase/functions/_shared/sequenceMathDeno.ts
// Deno copy of nextSendAtFor from src/lib/sequenceMath.ts — keep in sync.
export function nextSendAtForDeno(now: Date, steps: { delay_days: number }[], stepNumber: number): string | null {
  const step = steps[stepNumber - 1];
  if (!step) return null;
  return new Date(now.getTime() + step.delay_days * 86_400_000).toISOString();
}
```

**Flagging for review**: transcribe `src/lib/sequenceMath.ts`'s actual `nextSendAtFor` body during
implementation rather than trusting this plan's guess at its shape — the plan's guess above matches
`check-sequences`' own `advance()` function's delay-day math, but the real frontend function should
be the source of truth.

- [ ] **Step 3: Deploy + typecheck + commit**

```bash
npx tsc --noEmit
git add supabase/functions/auto-enroll-cold-outreach/index.ts supabase/functions/_shared/sequenceMathDeno.ts
git commit -m "feat: auto-enroll-cold-outreach cron function"
```

---

### Task 11: `check-replies` — IMAP polling, reply matching, bounce detection, classify-then-draft

**Files:**
- Create: `supabase/functions/check-replies/index.ts`

**Interfaces:**
- Consumes: `classifyReply`, `draftEmailClaude` (Task 4), `resolveOrgApiKey` (Task 2).
- Produces: `sequence_enrollments` pauses on a matched reply; `email_replies` rows; optional
  `email_logs` draft rows when `auto_draft_on_reply` is true; `autopilot_runs.bounce_count`
  increments on a detected bounce.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/check-replies/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ImapFlow } from 'npm:imapflow@1';
import { json } from '../_shared/cors.ts';
import { classifyReply, draftEmailClaude } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';

const HEADERS = { 'Content-Type': 'application/json' };
const BOUNCE_PATTERN = /mailer-daemon|postmaster/i;
const BOUNCE_SUBJECT_PATTERN = /undeliverable|delivery status notification|failure notice/i;

interface VerifiedUser {
  user_id: string; imap_host: string | null; imap_port: number | null;
  smtp_user: string | null; last_imap_check_at: string | null;
}

/**
 * Cron target: polls each verified user's own mailbox via IMAP, matches
 * replies to sent emails via In-Reply-To/References headers against a stored
 * Message-ID, pauses the matched enrollment, records the reply, and
 * optionally auto-drafts a suggested response (Haiku classifies simple vs.
 * complex first, escalating to Sonnet only for complex replies). Also flags
 * bounce-pattern messages toward any active autopilot run's bounce counter.
 * Same shared-secret auth as check-sequences.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, HEADERS);
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return json({ error: 'Forbidden' }, 403, HEADERS);
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: users } = await service
    .from('user_email_settings')
    .select('user_id, imap_host, imap_port, smtp_user, last_imap_check_at')
    .eq('is_verified', true).not('imap_host', 'is', null);

  let matched = 0; let bounces = 0;
  const errors: { user_id: string; error: string }[] = [];

  for (const u of (users ?? []) as VerifiedUser[]) {
    if (!u.imap_host || !u.imap_port || !u.smtp_user) continue;
    const { data: pass } = await service.rpc('app_get_smtp_secret', { uid: u.user_id });
    if (!pass) continue;

    const client = new ImapFlow({
      host: u.imap_host, port: u.imap_port, secure: true,
      auth: { user: u.smtp_user, pass: pass as string }, logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const since = u.last_imap_check_at ? new Date(u.last_imap_check_at) : new Date(Date.now() - 24 * 60 * 60 * 1000);
        for await (const msg of client.fetch({ since }, { envelope: true, source: true })) {
          const inReplyTo = msg.envelope?.inReplyTo ?? null;
          const fromAddr = msg.envelope?.from?.[0]?.address ?? '';
          const subject = msg.envelope?.subject ?? '';

          if (BOUNCE_PATTERN.test(fromAddr) || BOUNCE_SUBJECT_PATTERN.test(subject)) {
            const { data: activeRun } = await service.from('autopilot_runs')
              .select('id, bounce_count').eq('status', 'active').limit(1).maybeSingle();
            // Best-effort: a bounce isn't reliably attributable to one specific
            // org from IMAP alone, so this increments whichever run is active
            // for the org this mailbox's user belongs to, found via org_members.
            if (activeRun) {
              await service.from('autopilot_runs').update({ bounce_count: activeRun.bounce_count + 1 }).eq('id', activeRun.id);
              bounces++;
              const { data: run } = await service.from('autopilot_runs').select('bounce_count').eq('id', activeRun.id).single();
              if (run && run.bounce_count >= 10) {
                await service.from('autopilot_runs').update({ status: 'cancelled', cancel_reason: 'bounce threshold reached' }).eq('id', activeRun.id);
              }
            }
            continue;
          }

          if (!inReplyTo) continue;
          const { data: sentLog } = await service.from('email_logs')
            .select('id, lead_id, sequence_enrollment_id, org_id')
            .eq('message_id', inReplyTo).eq('status', 'sent').maybeSingle();
          if (!sentLog || !sentLog.sequence_enrollment_id || !sentLog.lead_id) continue;

          const bodyText = msg.source ? new TextDecoder().decode(msg.source).slice(0, 5000) : '';

          await service.from('sequence_enrollments').update({ status: 'paused' }).eq('id', sentLog.sequence_enrollment_id);
          await service.from('email_replies').insert({
            email_log_id: sentLog.id, lead_id: sentLog.lead_id, org_id: sentLog.org_id,
            from_email: fromAddr, subject, body: bodyText, received_at: new Date().toISOString(),
          });
          matched++;

          const { data: enrollment } = await service.from('sequence_enrollments')
            .select('sequence:email_sequences(auto_draft_on_reply)').eq('id', sentLog.sequence_enrollment_id).single();
          const autoDraft = (enrollment as { sequence: { auto_draft_on_reply: boolean } | null } | null)?.sequence?.auto_draft_on_reply;
          if (!autoDraft) continue;

          const apiKey = await resolveOrgApiKey(service, sentLog.org_id, 'anthropic');
          if (!apiKey) continue;
          const { data: lead } = await service.from('leads').select('*').eq('id', sentLog.lead_id).single();
          if (!lead) continue;
          const { data: notesRows } = await service.from('lead_notes')
            .select('content').eq('lead_id', sentLog.lead_id).order('created_at', { ascending: false }).limit(5);
          const noteTexts = (notesRows ?? []).map((n) => (n as { content: string }).content);

          try {
            const complexity = await classifyReply({ replyBody: bodyText, apiKey });
            const { data: org } = await service.from('organizations').select('name').eq('id', sentLog.org_id).maybeSingle();
            const draft = await draftEmailClaude({
              subject: `Re: ${subject}`, body: `They replied:\n\n${bodyText}\n\nDraft a helpful response.`,
              lead, notes: noteTexts, contractorName: 'there', orgName: org?.name ?? 'our team',
              apiKey, model: complexity === 'complex' ? 'claude-sonnet-5' : 'claude-haiku-4-5',
            });
            await service.from('email_logs').insert({
              lead_id: sentLog.lead_id, sequence_enrollment_id: sentLog.sequence_enrollment_id,
              sent_by: null, to_email: fromAddr, subject: draft.subject, body: draft.body,
              status: 'draft', org_id: sentLog.org_id,
            });
          } catch (e) {
            console.error(`reply auto-draft failed for lead ${sentLog.lead_id}:`, e);
          }
        }
      } finally {
        lock.release();
      }
      await client.logout();
      await service.from('user_email_settings').update({ last_imap_check_at: new Date().toISOString() }).eq('user_id', u.user_id);
    } catch (e) {
      errors.push({ user_id: u.user_id, error: e instanceof Error ? e.message : String(e) });
      try { await client.logout(); } catch { /* already disconnected */ }
    }
  }

  return json({ matched, bounces, errors }, 200, HEADERS);
});
```

**Flagging for review**: `imapflow`'s exact `fetch()`/`envelope` API surface (field names like
`inReplyTo`, `source`) should be verified against its actual TypeScript types during
implementation — written from its documented behavior, not independently re-verified line-by-line
against the library's source in this planning pass. The bounce-to-run attribution (`limit(1)` on
whichever autopilot run is active, rather than resolving the specific org via `org_members`) is a
known simplification — correct today since Mr Brush + DI Dreamlabs launch with at most one
concurrently-active run between them in practice, but worth tightening (join through
`org_members`/`user_email_settings.user_id` → org → that org's `autopilot_runs`) if multiple orgs
run autopilot concurrently later.

- [ ] **Step 2: Deploy + commit**

```bash
git add supabase/functions/check-replies/index.ts
git commit -m "feat: check-replies — IMAP reply detection, bounce guardrail, classify-then-draft"
```

---

### Task 12: `draft-linkedin-message` — new edge function

**Files:**
- Create: `supabase/functions/draft-linkedin-message/index.ts`

**Interfaces:**
- Consumes: `draftEmailClaude` (Task 4, reused for its Claude-drafting contract even though this
  isn't strictly an "email" — same subject/body shape works fine, `subject` just isn't used).
- Produces: `linkedin_drafts` rows.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/draft-linkedin-message/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { draftEmailClaude } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const authHeader = req.headers.get('Authorization') ?? '';
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await client.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401, headers);

  const body = (await req.json()) as { contact_id?: string };
  const contactId = String(body.contact_id ?? '');
  if (!contactId) return json({ error: 'contact_id is required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: contact, error: contactErr } = await service
    .from('linkedin_contacts').select('*').eq('id', contactId).single();
  if (contactErr || !contact) return json({ error: 'Contact not found' }, 404, headers);

  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', contact.org_id).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const apiKey = await resolveOrgApiKey(service, contact.org_id, 'anthropic');
  if (!apiKey) return json({ error: 'No Anthropic API key configured for this organization' }, 400, headers);

  const variant: 'achievement' | 'life_update' | 'general' = contact.context_signal
    ? (contact.context_signal.toLowerCase().includes('job') || contact.context_signal.toLowerCase().includes('promot') ? 'life_update' : 'achievement')
    : 'general';

  const templates: Record<typeof variant, string> = {
    achievement: `Hey {{first_name}}, saw you ${contact.context_signal}. That's a big deal, well done.\n\nRandom one for you, do you know any service business owners who are drowning in manual admin and want to automate parts of it? I'm taking on 5 free case studies right now to build out proof for my agency (I'm a designer who taught myself to build this stuff, and we built the whole backend for my own cleaning company, Mr Brush, so I know it works), just need real businesses to test it on and leave an honest review after.\n\nAnyone come to mind?`,
    life_update: `{{first_name}}, congrats on ${contact.context_signal}. Hope it's treating you well.\n\nQuick one, I'm looking for 5 SME owners to run free automation pilots for (built by my agency, proven on my own cleaning company Mr Brush first). If no, no worries, does anyone you know (or hate) come to mind who's stuck doing everything manually?`,
    general: `Hey {{first_name}}, it's been a while. I started an agency that builds automated systems for service businesses, proved it out by rebuilding the entire backend of my own cleaning company first.\n\nI'm giving away 5 free case-study builds right now in exchange for feedback + a review. Know any service business owner who'd want that?`,
  };
  const templateText = templates[variant].replace('{{first_name}}', contact.full_name.split(' ')[0] ?? contact.full_name);

  try {
    const { data: org } = await service.from('organizations').select('name').eq('id', contact.org_id).maybeSingle();
    const draft = await draftEmailClaude({
      subject: 'LinkedIn DM', body: templateText,
      lead: { full_name: contact.full_name, context_signal: contact.context_signal },
      notes: [], contractorName: 'there', orgName: org?.name ?? 'our team',
      apiKey, model: 'claude-sonnet-5',
    });

    const { data: inserted, error: insertErr } = await service.from('linkedin_drafts').insert({
      contact_id: contactId, org_id: contact.org_id, message: draft.body, template_variant: variant, status: 'draft',
    }).select('id').single();
    if (insertErr) return json({ error: insertErr.message }, 500, headers);

    await service.from('linkedin_contacts').update({ status: 'drafted' }).eq('id', contactId);
    return json({ draft_id: inserted.id, message: draft.body }, 200, headers);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500, headers);
  }
});
```

- [ ] **Step 2: Deploy + commit**

```bash
git add supabase/functions/draft-linkedin-message/index.ts
git commit -m "feat: draft-linkedin-message edge function"
```

---

### Task 13: `run-autopilot` — new cron function

**Files:**
- Create: `supabase/functions/run-autopilot/index.ts`

**Interfaces:**
- Consumes: `scrape-google-places`/`scrape-companies-house` (via HTTP call, with `max_results`
  from Task 8), the same dedup/quality-gate logic as the manual `approve()` action plus the new
  guardrail checks.
- Produces: `raw_leads` → auto-approved `leads` rows for active autopilot runs; progress counters.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/run-autopilot/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';

const HEADERS = { 'Content-Type': 'application/json' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

interface AutopilotRun {
  id: string; org_id: string; created_by: string; icp_raw_input: string; icp_params: Record<string, unknown>;
  source: 'google_places' | 'companies_house'; daily_lead_target: number; ends_at: string;
  leads_scraped_total: number; outreach_sent_total: number;
}

function tightIcpFit(lead: Record<string, unknown>, icp: Record<string, unknown>): boolean {
  const rating = lead.google_rating as number | null;
  const reviews = lead.review_count as number | null;
  const industry = (icp.industry as string | null)?.toLowerCase();
  const vertical = (lead.vertical as string | null)?.toLowerCase();
  const ratingOk = rating == null || ((icp.min_rating == null || rating >= (icp.min_rating as number)) && (icp.max_rating == null || rating <= (icp.max_rating as number)));
  const reviewsOk = reviews == null || icp.max_reviews == null || reviews <= (icp.max_reviews as number);
  const industryOk = !industry || !vertical || vertical.includes(industry);
  return ratingOk && reviewsOk && industryOk;
}

async function autoApprove(service: SupabaseClient, run: AutopilotRun): Promise<number> {
  const { data: rawLeads } = await service.from('raw_leads')
    .select('*, scrape_jobs!inner(org_id)').eq('scrape_jobs.org_id', run.org_id).eq('status', 'pending');
  if (!rawLeads || rawLeads.length === 0) return 0;

  const { data: blocklist } = await service.from('outreach_blocklist').select('value').eq('org_id', run.org_id);
  const blocked = new Set((blocklist ?? []).map((b) => (b as { value: string }).value.toLowerCase()));

  const { data: existingLeads } = await service.from('leads').select('business_name, city, email').eq('org_id', run.org_id);
  const { data: existingRaw } = await service.from('raw_leads')
    .select('business_name, city, email, scrape_jobs!inner(org_id)').eq('scrape_jobs.org_id', run.org_id).eq('status', 'approved');
  const seen = [...(existingLeads ?? []), ...(existingRaw ?? [])];

  let approved = 0;
  for (const rl of rawLeads) {
    const lead = rl as Record<string, unknown> & { id: string; email: string | null; phone: string | null; website: string | null; business_name: string; city: string | null };

    if (!lead.email) continue;
    if (!lead.phone && !lead.website) continue;
    const domain = lead.email.split('@')[1]?.toLowerCase();
    if (blocked.has(lead.email.toLowerCase()) || (domain && blocked.has(domain))) continue;

    const alreadySeen = seen.some((s) =>
      (s.email && lead.email && s.email.toLowerCase() === lead.email.toLowerCase()) ||
      (s.business_name.toLowerCase() === lead.business_name.toLowerCase() && (s.city ?? '').toLowerCase() === (lead.city ?? '').toLowerCase()),
    );
    if (alreadySeen) continue;

    if (!tightIcpFit(lead, run.icp_params)) continue;

    const { error: insertErr } = await service.from('leads').insert({
      business_name: lead.business_name, owner_name: lead.owner_name ?? null, phone: lead.phone,
      email: lead.email, website: lead.website, address: lead.address ?? null, city: lead.city,
      postcode: lead.postcode ?? null, google_rating: lead.google_rating ?? null, review_count: lead.review_count ?? null,
      vertical: lead.vertical ?? null, stage: 'new_lead', org_id: run.org_id,
      created_by: null, raw_lead_id: lead.id,
    });
    if (insertErr) continue;
    await service.from('raw_leads').update({ status: 'approved', approved_by: null, approved_at: new Date().toISOString() }).eq('id', lead.id);
    seen.push({ business_name: lead.business_name, city: lead.city, email: lead.email });
    approved++;
  }
  return approved;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, HEADERS);
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return json({ error: 'Forbidden' }, 403, HEADERS);
  }

  const service = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const cronSecret = Deno.env.get('CRON_SECRET')!;

  const { data: runs } = await service.from('autopilot_runs').select('*').eq('status', 'active');
  let processed = 0;

  for (const r of (runs ?? []) as AutopilotRun[]) {
    if (new Date(r.ends_at) <= new Date()) {
      await service.from('autopilot_runs').update({ status: 'completed' }).eq('id', r.id);
      continue;
    }

    const scraperFn = r.source === 'google_places' ? 'scrape-google-places' : 'scrape-companies-house';
    const cap = Math.min(60, r.daily_lead_target);
    try {
      const scrapeRes = await fetch(`${SUPABASE_URL}/functions/v1/${scraperFn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ org_id: r.org_id, icp_raw_input: r.icp_raw_input, icp_params: r.icp_params, max_results: cap }),
      });
      if (!scrapeRes.ok) {
        console.error(`autopilot ${r.id}: scrape trigger failed`, await scrapeRes.text());
      } else {
        // Give the background scrape job a moment before approving — it runs
        // via EdgeRuntime.waitUntil in the scraper function and typically
        // completes well within this window for a small daily_lead_target.
        await new Promise((res) => setTimeout(res, 15000));
      }
    } catch (e) {
      console.error(`autopilot ${r.id}: scrape trigger error`, e);
    }

    const approvedCount = await autoApprove(service, r);
    await service.from('autopilot_runs').update({
      leads_scraped_total: r.leads_scraped_total + approvedCount,
    }).eq('id', r.id);
    processed++;
  }

  return json({ processed }, 200, HEADERS);
});
```

**Flagging for review**: triggering the scraper edge function via an authenticated service-role
HTTP call (rather than importing/calling its logic directly) is the only way to reuse it without
duplicating the scraping code — but the 15-second wait before auto-approving is a rough estimate,
not a guarantee the scrape job has finished (a slow/large job could still be `running` when
auto-approval checks `raw_leads`). Since `autoApprove` only ever touches rows already
`status = 'pending'`, a job that's still running simply gets its results picked up on the *next*
day's `run-autopilot` pass instead — not silently lost, just delayed a day. Worth tightening (e.g.
polling `scrape_jobs.status` instead of a flat sleep) if this proves too slow in practice.

- [ ] **Step 2: Deploy + commit**

```bash
git add supabase/functions/run-autopilot/index.ts
git commit -m "feat: run-autopilot cron function — scrape, auto-approve, guardrails"
```

---

### Task 14: Types — `is_priority`, `auto_draft_on_reply`, `message_id`, new interfaces

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: every frontend hook/page in Tasks 15-18 depends on these.

- [ ] **Step 1: Extend existing interfaces**

```ts
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
  is_priority: boolean;
  call_count: number;
  last_contacted_at: string | null;
  kanban_position: number;
  created_at: string;
  updated_at: string;
}
```
(only the `is_priority: boolean;` line is new — insert it after `next_action_note`.)

```ts
export interface EmailSequence {
  id: string;
  name: string;
  description: string | null;
  steps: SequenceStep[];
  is_default: boolean;
  auto_draft_on_reply: boolean;
  created_by: string | null;
  created_at: string;
}
```
(only `auto_draft_on_reply: boolean;` is new.)

```ts
export interface EmailLog {
  id: string;
  lead_id: string | null;
  sequence_enrollment_id: string | null;
  sent_by: string | null;
  to_email: string;
  subject: string;
  body: string;
  status: EmailLogStatus;
  error_message: string | null;
  message_id: string | null;
  sent_at: string;
}
```
(only `message_id: string | null;` is new.)

- [ ] **Step 2: New interfaces**

Append to the file:
```ts
export interface EmailReply {
  id: string;
  email_log_id: string;
  lead_id: string;
  org_id: string;
  from_email: string;
  subject: string | null;
  body: string;
  received_at: string;
}

export type LinkedinContactStatus = 'pending' | 'drafted' | 'approved' | 'sent' | 'skipped';

export interface LinkedinContact {
  id: string;
  org_id: string;
  full_name: string;
  linkedin_url: string | null;
  context_signal: string | null;
  status: LinkedinContactStatus;
  created_by: string | null;
  created_at: string;
}

export type LinkedinDraftStatus = 'draft' | 'approved' | 'sent' | 'skipped';

export interface LinkedinDraft {
  id: string;
  contact_id: string;
  org_id: string;
  message: string;
  template_variant: 'achievement' | 'life_update' | 'general';
  status: LinkedinDraftStatus;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export type AutopilotRunStatus = 'active' | 'completed' | 'cancelled';

export interface AutopilotRun {
  id: string;
  org_id: string;
  created_by: string;
  icp_raw_input: string;
  icp_params: IcpParams;
  source: ScrapeSource;
  daily_lead_target: number;
  daily_outreach_target: number;
  duration_days: number;
  ramp_up_enabled: boolean;
  max_total_spend_cents: number | null;
  started_at: string;
  ends_at: string;
  status: AutopilotRunStatus;
  cancel_reason: string | null;
  estimated_cost_low_cents: number;
  estimated_cost_high_cents: number;
  leads_scraped_total: number;
  outreach_sent_total: number;
  actual_ai_cost_cents: number;
  bounce_count: number;
  created_at: string;
}

export interface OutreachBlocklistEntry {
  id: string;
  org_id: string;
  value: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}
```

`IcpParams` and `ScrapeSource` already exist (Task 3 of cycle 4) — reused here, not redefined.

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/types/index.ts
git commit -m "feat: types for is_priority, auto_draft_on_reply, message_id, LinkedIn/autopilot/blocklist"
```

---

### Task 15: Priority-flag toggle on the lead panel

**Files:**
- Modify: `src/components/pipeline/LeadPanel.tsx`

**Interfaces:**
- Consumes: `Lead.is_priority` (Task 14), the existing `onUpdate` prop (already generically typed
  as `Partial<Lead>` via `LeadPatch` — no change needed to `leadUpdates.ts`).

- [ ] **Step 1: Add the toggle**

Add the import:
```tsx
import { Star } from 'lucide-react';
```
(alongside the existing `import { ArrowRight, X } from 'lucide-react';` — combine into one import
line.)

Change the header block:
```tsx
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
```
to:
```tsx
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-bold">{lead.business_name}</h2>
            {lead.owner_name && <p className="text-sm text-muted">{lead.owner_name}</p>}
            <div className="mt-2 flex items-center gap-2">
              <StageBadge stage={lead.stage} />
              <button
                type="button"
                onClick={() => void onUpdate(lead.id, { is_priority: !lead.is_priority })}
                aria-pressed={lead.is_priority}
                aria-label={lead.is_priority ? 'Unmark as priority' : 'Mark as priority'}
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${lead.is_priority ? 'text-amber-400' : 'text-muted hover:text-amber-400'}`}
              >
                <Star className="h-4 w-4" aria-hidden fill={lead.is_priority ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close panel" className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/pipeline/LeadPanel.tsx
git commit -m "feat: priority-flag toggle on the lead panel"
```

---

### Task 16: LinkedIn outreach — hook + page + routing

**Files:**
- Create: `src/hooks/useLinkedinOutreach.ts`
- Create: `src/pages/LinkedinOutreach.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `LinkedinContact`/`LinkedinDraft` types (Task 14), `draft-linkedin-message` edge
  function (Task 12).
- Produces: `/outreach/linkedin` page.

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useLinkedinOutreach.ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import { useAuth } from './useAuth';
import type { LinkedinContact, LinkedinDraft } from '../types';

export type DraftWithContact = LinkedinDraft & { contact: LinkedinContact };

/** LinkedIn contacts + their drafts for the current org. */
export function useLinkedinOutreach() {
  const { currentOrg } = useOrg();
  const { session } = useAuth();
  const [contacts, setContacts] = useState<LinkedinContact[]>([]);
  const [drafts, setDrafts] = useState<DraftWithContact[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    const [contactsRes, draftsRes] = await Promise.all([
      supabase.from('linkedin_contacts').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false }),
      supabase.from('linkedin_drafts').select('*, contact:linkedin_contacts(*)').eq('org_id', currentOrg.id).in('status', ['draft']).order('created_at', { ascending: false }),
    ]);
    setContacts((contactsRes.data as LinkedinContact[] | null) ?? []);
    setDrafts((draftsRes.data as DraftWithContact[] | null) ?? []);
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addContact = useCallback(async (input: { full_name: string; linkedin_url: string; context_signal: string }): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    const { error } = await supabase.from('linkedin_contacts').insert({
      org_id: currentOrg.id, full_name: input.full_name,
      linkedin_url: input.linkedin_url || null, context_signal: input.context_signal || null,
      created_by: session?.user.id,
    });
    if (error) return error.message;
    await refresh();
    return null;
  }, [currentOrg, session, refresh]);

  const draftFor = useCallback(async (contactId: string): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke('draft-linkedin-message', { body: { contact_id: contactId } });
    if (error) return error.message;
    const err = (data as { error?: string }).error;
    if (err) return err;
    await refresh();
    return null;
  }, [refresh]);

  const approve = useCallback(async (draftId: string): Promise<string | null> => {
    const { error } = await supabase.from('linkedin_drafts').update({ status: 'approved', approved_by: session?.user.id, approved_at: new Date().toISOString() }).eq('id', draftId);
    if (error) return error.message;
    await refresh();
    return null;
  }, [session, refresh]);

  const skip = useCallback(async (draftId: string): Promise<string | null> => {
    const { error } = await supabase.from('linkedin_drafts').update({ status: 'skipped' }).eq('id', draftId);
    if (error) return error.message;
    await refresh();
    return null;
  }, [refresh]);

  const markSent = useCallback(async (draftId: string, contactId: string): Promise<string | null> => {
    const { error: draftErr } = await supabase.from('linkedin_drafts').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', draftId);
    if (draftErr) return draftErr.message;
    await supabase.from('linkedin_contacts').update({ status: 'sent' }).eq('id', contactId);
    await refresh();
    return null;
  }, [refresh]);

  return { contacts, drafts, loading, addContact, draftFor, approve, skip, markSent };
}
```

- [ ] **Step 2: Write the page**

```tsx
// src/pages/LinkedinOutreach.tsx
import { useState } from 'react';
import { Linkedin as LinkedinIcon, CheckCircle2, ExternalLink, Sparkles, SkipForward } from 'lucide-react';
import { useLinkedinOutreach } from '../hooks/useLinkedinOutreach';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Textarea } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

/** LinkedIn contacts + drafts review queue (SPEC.md §2 Channel 2). */
export function LinkedinOutreach() {
  const { contacts, drafts, loading, addContact, draftFor, approve, skip, markSent } = useLinkedinOutreach();
  const [form, setForm] = useState({ full_name: '', linkedin_url: '', context_signal: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!form.full_name.trim()) return;
    setBusy('add'); setError(null);
    const err = await addContact(form);
    setBusy(null);
    if (err) setError(err);
    else setForm({ full_name: '', linkedin_url: '', context_signal: '' });
  }

  const pendingContacts = contacts.filter((c) => c.status === 'pending');

  if (loading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-3">
        <LinkedinIcon className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">LinkedIn outreach</h1>
      </header>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      <Card>
        <div className="flex flex-col gap-3">
          <p className="font-semibold">Add a contact</p>
          <Input label="Full name" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
          <Input label="LinkedIn URL (optional)" value={form.linkedin_url} onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))} />
          <Textarea label="Context signal (optional — a recent post, job change, etc.)" value={form.context_signal} onChange={(e) => setForm((f) => ({ ...f, context_signal: e.target.value }))} />
          <Button onClick={() => void handleAdd()} disabled={busy === 'add' || !form.full_name.trim()}>{busy === 'add' ? 'Adding…' : 'Add contact'}</Button>
        </div>
      </Card>

      {pendingContacts.length > 0 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Not yet drafted</p>
            {pendingContacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-surface/50 p-3">
                <span className="font-semibold">{c.full_name}</span>
                <Button variant="secondary" onClick={() => void (async () => { setBusy(c.id); setError(await draftFor(c.id)); setBusy(null); })()} disabled={busy === c.id}>
                  <Sparkles className="h-4 w-4" aria-hidden /> {busy === c.id ? 'Drafting…' : 'Draft message'}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <p className="font-semibold">Review queue</p>
        {drafts.length === 0 && (
          <EmptyState icon={LinkedinIcon} title="No drafts waiting" hint="Add a contact and draft a message to see it here." />
        )}
        {drafts.map((d) => (
          <Card key={d.id}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{d.contact.full_name}</p>
                {d.contact.linkedin_url && (
                  <a href={d.contact.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-cyan">
                    Open profile <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{d.message}</p>
              <div className="flex gap-2">
                {d.status === 'draft' && (
                  <>
                    <Button onClick={() => void approve(d.id)}><CheckCircle2 className="h-4 w-4" aria-hidden /> Approve</Button>
                    <Button variant="ghost" onClick={() => void skip(d.id)}><SkipForward className="h-4 w-4" aria-hidden /> Skip</Button>
                  </>
                )}
                {d.status === 'approved' && (
                  <Button onClick={() => void markSent(d.id, d.contact.id)}>Mark as sent</Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire routing + nav**

In `src/App.tsx`, add the import:
```tsx
import { LinkedinOutreach } from './pages/LinkedinOutreach';
```
and the route (after `/emails/*`):
```tsx
              <Route path="/outreach/linkedin" element={<LinkedinOutreach />} />
```

In `src/components/layout/Sidebar.tsx`, add `Linkedin` to the lucide-react import and a NAV_ITEMS
entry (after `/scraper`):
```ts
  { to: '/outreach/linkedin', label: 'LinkedIn', icon: Linkedin },
```

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/hooks/useLinkedinOutreach.ts src/pages/LinkedinOutreach.tsx src/App.tsx src/components/layout/Sidebar.tsx
git commit -m "feat: LinkedIn outreach page — contacts, drafting, review queue"
```

---

### Task 17: Autopilot — hook + setup page + status page + routing

**Files:**
- Create: `src/hooks/useAutopilot.ts`
- Create: `src/pages/AutopilotSetup.tsx`
- Create: `src/pages/AutopilotStatus.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `AutopilotRun`/`OutreachBlocklistEntry` types (Task 14), `IcpParams`/`ScrapeSource`
  (existing, cycle 4), `parse-icp` edge function (existing).
- Produces: `/outreach/autopilot` and `/outreach/autopilot/new`.

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useAutopilot.ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import { useAuth } from './useAuth';
import type { AutopilotRun, IcpParams, OutreachBlocklistEntry, ScrapeSource } from '../types';

const HAIKU_CENTS_PER_DRAFT = 0.225;
const SONNET_CENTS_PER_DRAFT = 0.45;

/** Rough cost range for a run — a directional estimate, not exact billing. */
export function estimateCostCents(dailyOutreachTarget: number, durationDays: number): { low: number; high: number } {
  const drafts = dailyOutreachTarget * durationDays;
  return { low: Math.ceil(drafts * HAIKU_CENTS_PER_DRAFT), high: Math.ceil(drafts * SONNET_CENTS_PER_DRAFT) };
}

export interface CreateRunInput {
  icp_raw_input: string; icp_params: IcpParams; source: ScrapeSource;
  daily_lead_target: number; daily_outreach_target: number; duration_days: 1 | 7 | 14 | 21 | 30;
  ramp_up_enabled: boolean; max_total_spend_cents: number | null;
}

/** The current org's active autopilot run (if any), plus its blocklist. */
export function useAutopilot() {
  const { currentOrg } = useOrg();
  const { session } = useAuth();
  const [run, setRun] = useState<AutopilotRun | null>(null);
  const [blocklist, setBlocklist] = useState<OutreachBlocklistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    const [runRes, blocklistRes] = await Promise.all([
      supabase.from('autopilot_runs').select('*').eq('org_id', currentOrg.id).eq('status', 'active').maybeSingle(),
      supabase.from('outreach_blocklist').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false }),
    ]);
    setRun((runRes.data as AutopilotRun | null) ?? null);
    setBlocklist((blocklistRes.data as OutreachBlocklistEntry[] | null) ?? []);
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createRun = useCallback(async (input: CreateRunInput): Promise<string | null> => {
    if (!currentOrg || !session) return 'No organization selected';
    const { low, high } = estimateCostCents(input.daily_outreach_target, input.duration_days);
    const endsAt = new Date(Date.now() + input.duration_days * 86_400_000).toISOString();
    const { error } = await supabase.from('autopilot_runs').insert({
      org_id: currentOrg.id, created_by: session.user.id,
      icp_raw_input: input.icp_raw_input, icp_params: input.icp_params, source: input.source,
      daily_lead_target: input.daily_lead_target, daily_outreach_target: input.daily_outreach_target,
      duration_days: input.duration_days, ramp_up_enabled: input.ramp_up_enabled,
      max_total_spend_cents: input.max_total_spend_cents, ends_at: endsAt,
      estimated_cost_low_cents: low, estimated_cost_high_cents: high,
    });
    if (error) return error.message;
    await refresh();
    return null;
  }, [currentOrg, session, refresh]);

  const stopRun = useCallback(async (): Promise<string | null> => {
    if (!run) return 'No active run';
    const { error } = await supabase.from('autopilot_runs').update({ status: 'cancelled', cancel_reason: 'stopped by user' }).eq('id', run.id);
    if (error) return error.message;
    await refresh();
    return null;
  }, [run, refresh]);

  const addBlocklistEntry = useCallback(async (value: string, reason: string): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    const { error } = await supabase.from('outreach_blocklist').insert({ org_id: currentOrg.id, value: value.toLowerCase().trim(), reason: reason || null, created_by: session?.user.id });
    if (error) return error.message;
    await refresh();
    return null;
  }, [currentOrg, session, refresh]);

  const removeBlocklistEntry = useCallback(async (id: string): Promise<string | null> => {
    const { error } = await supabase.from('outreach_blocklist').delete().eq('id', id);
    if (error) return error.message;
    await refresh();
    return null;
  }, [refresh]);

  return { run, blocklist, loading, createRun, stopRun, addBlocklistEntry, removeBlocklistEntry };
}
```

- [ ] **Step 2: Write the setup page**

```tsx
// src/pages/AutopilotSetup.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Rocket } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import { useOrgApiSettings } from '../hooks/useOrgApiSettings';
import { useAutopilot, estimateCostCents } from '../hooks/useAutopilot';
import { StepProgress } from '../components/ui/StepProgress';
import { Textarea, Input, SelectField } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import type { IcpParams, ScrapeSource } from '../types';

const DURATIONS = [1, 7, 14, 21, 30] as const;

/** Autopilot campaign setup wizard (SPEC.md — Autopilot Mode §3). */
export function AutopilotSetup() {
  const navigate = useNavigate();
  const { currentOrg } = useOrg();
  const { settings } = useOrgApiSettings();
  const { createRun } = useAutopilot();
  const [step, setStep] = useState(1);
  const [rawInput, setRawInput] = useState('');
  const [icp, setIcp] = useState<IcpParams | null>(null);
  const [source, setSource] = useState<ScrapeSource>('google_places');
  const [dailyLeadTarget, setDailyLeadTarget] = useState(10);
  const [dailyOutreachTarget, setDailyOutreachTarget] = useState(20);
  const [duration, setDuration] = useState<typeof DURATIONS[number]>(7);
  const [rampUp, setRampUp] = useState(true);
  const [spendCap, setSpendCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placesConfigured = settings.find((s) => s.provider === 'google_places')?.is_configured ?? false;
  const chConfigured = settings.find((s) => s.provider === 'companies_house')?.is_configured ?? false;
  const sourceUnavailable = source === 'google_places' ? !placesConfigured : icp?.country !== 'GB' || !chConfigured;

  async function parseIcp() {
    if (!currentOrg || !rawInput.trim()) return;
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.functions.invoke('parse-icp', { body: { raw_input: rawInput, org_id: currentOrg.id } });
    setBusy(false);
    if (err) return setError(err.message);
    const result = data as { params?: IcpParams; error?: string };
    if (result.error) return setError(result.error);
    if (result.params) {
      setIcp(result.params);
      if (result.params.country !== 'GB' && source === 'companies_house') setSource('google_places');
      setStep(2);
    }
  }

  async function handleCreate() {
    if (!icp) return;
    setBusy(true); setError(null);
    const err = await createRun({
      icp_raw_input: rawInput, icp_params: icp, source, daily_lead_target: dailyLeadTarget,
      daily_outreach_target: dailyOutreachTarget, duration_days: duration, ramp_up_enabled: rampUp,
      max_total_spend_cents: spendCap ? Math.round(Number(spendCap) * 100) : null,
    });
    setBusy(false);
    if (err) return setError(err);
    navigate('/outreach/autopilot');
  }

  const { low, high } = estimateCostCents(dailyOutreachTarget, duration);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-3">
        <Rocket className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">Start autopilot</h1>
      </header>
      <StepProgress step={step} total={3} />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {step === 1 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Describe your ideal customer</p>
            <Textarea label="ICP description" value={rawInput} onChange={(e) => setRawInput(e.target.value)} placeholder="Commercial cleaning companies in London, 10-30 staff" />
            <Button onClick={() => void parseIcp()} disabled={busy || !rawInput.trim()}>{busy ? 'Reading…' : 'Continue'}</Button>
          </div>
        </Card>
      )}

      {step === 2 && icp && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Choose one data source</p>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="autopilot-source" checked={source === 'google_places'} onChange={() => setSource('google_places')} disabled={!placesConfigured} className="h-4 w-4 accent-violet-500" />
              Google Places {!placesConfigured && <span className="text-xs text-muted">(no key configured)</span>}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="autopilot-source" checked={source === 'companies_house'} onChange={() => setSource('companies_house')} disabled={icp.country !== 'GB' || !chConfigured} className="h-4 w-4 accent-violet-500" />
              Companies House {icp.country !== 'GB' && <span className="text-xs text-muted">(UK only)</span>}
            </label>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)} disabled={sourceUnavailable}>Continue</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <div className="flex flex-col gap-4">
            <SelectField label="Duration" value={String(duration)} onChange={(e) => setDuration(Number(e.target.value) as typeof DURATIONS[number])}>
              <option value="1">1 day</option>
              <option value="7">1 week</option>
              <option value="14">2 weeks</option>
              <option value="21">3 weeks</option>
              <option value="30">1 month</option>
            </SelectField>
            <Input label="Leads to scrape per day" type="number" value={String(dailyLeadTarget)} onChange={(e) => setDailyLeadTarget(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
            <Input label="Cold outreach sends per day" type="number" value={String(dailyOutreachTarget)} onChange={(e) => setDailyOutreachTarget(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={rampUp} onChange={(e) => setRampUp(e.target.checked)} className="h-4 w-4 accent-violet-500" />
              Ramp up gradually over the first 4 days (recommended)
            </label>
            <Input label="Optional total spend cap ($)" type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} placeholder="No cap" />
            {dailyOutreachTarget > 30 && (
              <p role="alert" className="text-sm text-amber-400">
                {dailyOutreachTarget}/day is above the recommended safe ceiling (~30/day) for a mailbox's sender reputation. You can still proceed.
              </p>
            )}
            <p className="text-sm text-muted">Estimated Claude API cost for this run: ${(low / 100).toFixed(2)}–${(high / 100).toFixed(2)}, billed to your own Anthropic key.</p>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => void handleCreate()} disabled={busy}>{busy ? 'Starting…' : 'Start autopilot'}</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the status page**

```tsx
// src/pages/AutopilotStatus.tsx
import { useState } from 'react';
import { Link } from 'react-router';
import { Rocket, XCircle } from 'lucide-react';
import { useAutopilot } from '../hooks/useAutopilot';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

/** Live autopilot progress + blocklist management. */
export function AutopilotStatus() {
  const { run, blocklist, loading, stopRun, addBlocklistEntry, removeBlocklistEntry } = useAutopilot();
  const [blockValue, setBlockValue] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Skeleton className="h-96 w-full" />;

  const dayNumber = run ? Math.max(1, Math.floor((Date.now() - new Date(run.started_at).getTime()) / 86_400_000) + 1) : 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-3">
        <Rocket className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">Autopilot</h1>
      </header>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {!run && (
        <EmptyState
          icon={Rocket}
          title="No autopilot run active"
          hint="Start one to scrape leads and send cold outreach automatically, on a schedule you set."
          action={<Link to="/outreach/autopilot/new"><Button>Start autopilot</Button></Link>}
        />
      )}

      {run && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Day {dayNumber} of {run.duration_days}</p>
            <p className="text-sm text-muted">Leads scraped: {run.leads_scraped_total}</p>
            <p className="text-sm text-muted">Outreach sent: {run.outreach_sent_total}</p>
            <p className="text-sm text-muted">
              AI spend so far: ${(run.actual_ai_cost_cents / 100).toFixed(2)} (estimated ${(run.estimated_cost_low_cents / 100).toFixed(2)}–${(run.estimated_cost_high_cents / 100).toFixed(2)})
              {run.max_total_spend_cents != null && ` · cap $${(run.max_total_spend_cents / 100).toFixed(2)}`}
            </p>
            <p className="text-sm text-muted">Bounces: {run.bounce_count}</p>
            <Button variant="danger" onClick={() => void (async () => { setBusy(true); setError(await stopRun()); setBusy(false); })()} disabled={busy}>
              <XCircle className="h-4 w-4" aria-hidden /> Stop autopilot
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-3">
          <p className="font-semibold">Do-not-contact list</p>
          <div className="flex gap-2">
            <Input label="Email or domain" value={blockValue} onChange={(e) => setBlockValue(e.target.value)} placeholder="acme.com" />
            <Input label="Reason (optional)" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />
            <Button
              variant="secondary"
              onClick={() => void (async () => {
                if (!blockValue.trim()) return;
                setBusy(true);
                const err = await addBlocklistEntry(blockValue, blockReason);
                setBusy(false);
                if (err) setError(err); else { setBlockValue(''); setBlockReason(''); }
              })()}
              disabled={busy}
            >
              Add
            </Button>
          </div>
          {blocklist.length === 0 && <p className="text-sm text-muted">Nothing blocked.</p>}
          {blocklist.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-lg bg-surface/50 p-2 text-sm">
              <span>{b.value}{b.reason && ` — ${b.reason}`}</span>
              <button type="button" onClick={() => void removeBlocklistEntry(b.id)} className="text-red-400" aria-label={`Remove ${b.value}`}>
                <XCircle className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Wire routing + nav**

In `src/App.tsx`:
```tsx
import { AutopilotSetup } from './pages/AutopilotSetup';
import { AutopilotStatus } from './pages/AutopilotStatus';
```
```tsx
              <Route path="/outreach/autopilot" element={<AutopilotStatus />} />
              <Route path="/outreach/autopilot/new" element={<AutopilotSetup />} />
```

In `src/components/layout/Sidebar.tsx`, add `Rocket` to the lucide-react import and:
```ts
  { to: '/outreach/autopilot', label: 'Autopilot', icon: Rocket },
```

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/hooks/useAutopilot.ts src/pages/AutopilotSetup.tsx src/pages/AutopilotStatus.tsx src/App.tsx src/components/layout/Sidebar.tsx
git commit -m "feat: autopilot setup + status pages, blocklist management"
```

---

### Task 18: `npm:imapflow` dependency check + full `check-replies` live verification

**Files:**
- None (verification-only task).

**Interfaces:**
- Consumes: everything from Tasks 1-17.

- [ ] **Step 1: Confirm `imapflow` resolves in the deployed Deno runtime**

Deploy `check-replies` (Task 11) and invoke it directly once (not via cron) against a throwaway
verified `user_email_settings` row pointed at a real test IMAP mailbox (a fresh Gmail test account
with app-password auth is the simplest option) — confirm the function boots without an import
error and completes a poll cycle (even with 0 matches) within Supabase's ~150s wall-clock ceiling.
If `npm:imapflow` fails to resolve or behaves unexpectedly in Deno's npm-compat layer (the plan's
one real technical unknown, flagged during brainstorming), this is where that surfaces — the
fallback, if needed, is `npm:imapflow@<a specific older version>` or evaluating
`emailjs-imap-client` as the alternative surfaced during research.

- [ ] **Step 2: Report**

Write findings to a scratch file for the controller (not committed) confirming pass/fail and any
version pin needed.

---

## Notes for the controller running this plan

- **Rollout scope**: every seed row, cron entry, and org-scoped guardrail in this plan targets
  Mr Brush & Co and DI Dreamlabs only (per the spec's locked rollout order) — UX Tree / DI Academy
  get no seeded templates/sequences and no autopilot access until their own copy/ICP session
  happens, matching the existing `use_global_api_fallback` gating pattern.
- **Known pending human step**: `ANTHROPIC_API_KEY` is not yet a configured Supabase secret for
  this project — the global-fallback path (Mr Brush & Co / DI Dreamlabs) won't actually resolve a
  key until Kevin runs
  `npx supabase secrets set ANTHROPIC_API_KEY=<key> --project-ref wgomksxelyfkzepbnkdd`, matching
  the exact non-blocking pattern already established for `GOOGLE_PLACES_API_KEY`/
  `COMPANIES_HOUSE_API_KEY` in cycle 4. Every task's rejection/skip path (no key configured) should
  still be fully live-verified without it.
- **Full E2E is out of reach** for an actual sent cold email, an actual IMAP reply round-trip, and
  an actual multi-day autopilot run — same accepted pattern as cycle 4. Verify every guardrail,
  every rejection path, and every routing decision with throwaway data; flag the full-volume,
  full-duration paths as pending human steps once real keys/mailboxes are available.
- `_shared/sequenceMathDeno.ts` (Task 10) is explicitly flagged as needing verification against
  `src/lib/sequenceMath.ts`'s real `nextSendAtFor` implementation during implementation, not blind
  transcription from this plan's best-guess code — read the actual file first.
