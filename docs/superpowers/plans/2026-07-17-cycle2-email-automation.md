# Cycle 2 — Email Automation + AI Note Parsing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full email module — SMTP config (Vault), templates, AI composer (Gemini 2.5 Flash), sequences with daily draft cron, review-before-send queue, logs — plus the parse-notes AI lead-update toggle.

**Architecture:** React 19 + Vite + TS strict + Tailwind v4 SPA talking to Supabase (`wgomksxelyfkzepbnkdd`). Server logic in Deno edge functions following the existing `admin-users` pattern (JWT check → service client). Pure logic (variable substitution, schedule math, CSV) in `src/lib/` with vitest TDD. Spec: `docs/superpowers/specs/2026-07-17-cycle2-email-automation-design.md`.

**Tech Stack:** supabase-js v2, denomailer (Deno SMTP), Gemini REST API (`gemini-2.5-flash`), dnd-kit (already installed), lucide-react, vitest.

## Global Constraints

- TypeScript strict; no `any` (cast via `unknown`); named exports only; Tailwind utilities only; every component handles loading/error/empty; components < 150 lines; JSDoc on exported functions.
- Design tokens in use: `bg-navy/surface/card`, `border-line`, `text-muted/offwhite/cyan`, `bg-violet`, min-h-11 touch targets, `motion-safe:`/`motion-reduce:`.
- Existing UI primitives (import, don't recreate): `Button (variant: primary|secondary|ghost)`, `Input/Textarea/SelectField (label prop)`, `Modal (open,onClose,title)`, `Card`, `Skeleton`, `EmptyState (icon,title,hint,action?)`, `StepProgress (step,total)`.
- **No automation ever sends an email — only a user click does.**
- Commits: `feat:`/`fix:`/`chore:` style, one per task, push after each.
- Working dir: `C:\Users\kevin\Projects\dreamlabs-sales`. Commands below are POSIX (Git Bash).
- Verify commands: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
- Management-API SQL runner (bypasses RLS; for verification):
  `curl -s -X POST "https://api.supabase.com/v1/projects/wgomksxelyfkzepbnkdd/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d @query.json`
  (`SUPABASE_ACCESS_TOKEN` is in the project's gitignored `.env`; write the JSON `{"query":"..."}` to a file to avoid quoting bugs.)
- Edge function deploys: `npx supabase functions deploy <name> --no-verify-jwt=false` using the linked project (access token in `.env`). Function secrets: `npx supabase secrets set NAME=value`.
- Browser verification: dev server on `http://localhost:5173`, Kevin's session usually signed in. DB ground truth via the management-API runner.

---

### Task 1: Email domain types + template variable substitution (TDD)

**Files:**
- Modify: `src/types/index.ts` (append)
- Create: `src/lib/templateVars.ts`
- Test: `src/lib/templateVars.test.ts`

**Interfaces:**
- Consumes: `Lead`, `PackageTier` from `src/types`; `packageLabel`, `formatCurrency` from `src/lib/utils`.
- Produces (later tasks import these exact names):
  - Types: `EmailTemplate`, `TemplateType`, `SequenceStep`, `EmailSequence`, `SequenceEnrollment`, `EnrollmentStatus`, `EmailLog`, `EmailLogStatus`, `UserEmailSettings`, `EmailProvider`, `LeadSuggestion`
  - `TEMPLATE_VARIABLES: { key: string; label: string }[]`
  - `substituteVariables(text: string, vars: Record<string, string | null | undefined>): { text: string; missing: string[] }`
  - `buildTemplateVars(lead: Lead, contractorName: string, notes?: string[]): Record<string, string | null>`

- [ ] **Step 1: Append the domain types**

Append to `src/types/index.ts`:

```ts
export type TemplateType =
  | 'initial_followup' | 'second_chase' | 'not_now_nurture'
  | 'audit_confirmation' | 'proposal_followup' | 'custom';

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  template_type: TemplateType;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
}

export interface SequenceStep {
  delay_days: number;
  template_type: TemplateType;
  subject_override: string | null;
}

export interface EmailSequence {
  id: string;
  name: string;
  description: string | null;
  steps: SequenceStep[];
  is_default: boolean;
  created_by: string | null;
  created_at: string;
}

export type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface SequenceEnrollment {
  id: string;
  lead_id: string;
  sequence_id: string;
  current_step: number;
  next_send_at: string | null;
  status: EnrollmentStatus;
  enrolled_by: string | null;
  created_at: string;
}

export type EmailLogStatus = 'draft' | 'sent' | 'failed';

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
  sent_at: string;
}

export type EmailProvider = 'gmail' | 'outlook' | 'yahoo' | 'smtp';

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

/** parse-notes suggestion: only fields the AI wants to change are present. */
export interface LeadSuggestion {
  stage?: Stage;
  deal_value?: number;
  package_tier?: PackageTier;
  next_action_date?: string;
  next_action_note?: string;
  pain_point?: string;
  rationale: string;
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/templateVars.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildTemplateVars, substituteVariables } from './templateVars';
import type { Lead } from '../types';

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: 'x', business_name: 'Acme Ltd', owner_name: null, phone: null, email: null,
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

describe('substituteVariables', () => {
  it('replaces known variables', () => {
    const r = substituteVariables('Hi {{first_name}} of {{business_name}}', { first_name: 'Ana', business_name: 'Acme' });
    expect(r.text).toBe('Hi Ana of Acme');
    expect(r.missing).toEqual([]);
  });
  it('blanks and reports variables without a value', () => {
    const r = substituteVariables('Re: {{business_name}} on {{audit_date}}', { business_name: 'Acme', audit_date: null });
    expect(r.text).toBe('Re: Acme on ');
    expect(r.missing).toEqual(['audit_date']);
  });
  it('reports unknown variables as missing and blanks them', () => {
    const r = substituteVariables('{{nonsense}}!', {});
    expect(r.text).toBe('!');
    expect(r.missing).toEqual(['nonsense']);
  });
  it('handles repeated variables once in missing', () => {
    const r = substituteVariables('{{x}} {{x}}', {});
    expect(r.missing).toEqual(['x']);
  });
});

describe('buildTemplateVars', () => {
  const lead = makeLead({
    business_name: 'Shiny Cleaners', owner_name: 'Ana Diaz',
    package_tier: 'ai_foundation', deal_value: 1200,
  });
  it('derives first_name from owner_name', () => {
    expect(buildTemplateVars(lead, 'Kevin').first_name).toBe('Ana');
  });
  it('formats package and deal value', () => {
    const v = buildTemplateVars(lead, 'Kevin');
    expect(v.package_name).toBe('AI Foundation');
    expect(v.deal_value).toBe('£1,200');
    expect(v.contractor_name).toBe('Kevin');
  });
  it('extracts pain_point from a debrief note when present', () => {
    const notes = ['Call outcome: Positive\n\nMain pain point:\nNo online booking\n\nObjections:\nCost'];
    expect(buildTemplateVars(lead, 'Kevin', notes).pain_point).toBe('No online booking');
  });
  it('leaves unresolvable vars null', () => {
    const v = buildTemplateVars(makeLead({}), 'Kevin');
    expect(v.first_name).toBeNull();
    expect(v.audit_date).toBeNull();
    expect(v.cal_link).toBeNull();
    expect(v.pain_point).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/templateVars.test.ts`
Expected: FAIL — cannot find module './templateVars'.

- [ ] **Step 4: Write `src/lib/templateVars.ts`**

```ts
import { formatCurrency, packageLabel } from './utils';
import type { Lead } from '../types';

/** The {{variables}} templates may use (SPEC.md §7). */
export const TEMPLATE_VARIABLES: { key: string; label: string }[] = [
  { key: 'first_name', label: 'First name' },
  { key: 'business_name', label: 'Business name' },
  { key: 'owner_name', label: 'Owner name' },
  { key: 'audit_date', label: 'Audit date' },
  { key: 'package_name', label: 'Package' },
  { key: 'deal_value', label: 'Deal value' },
  { key: 'contractor_name', label: 'Your name' },
  { key: 'pain_point', label: 'Pain point' },
  { key: 'cal_link', label: 'Booking link' },
];

/** Replaces {{key}} with values; empty/unknown keys blank out and are reported in `missing`. */
export function substituteVariables(
  text: string,
  vars: Record<string, string | null | undefined>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === null || value === undefined || value === '') {
      missing.add(key);
      return '';
    }
    return value;
  });
  return { text: out, missing: [...missing] };
}

/** Builds the variable map for a lead. `notes` = latest note contents, newest first. */
export function buildTemplateVars(
  lead: Lead,
  contractorName: string,
  notes: string[] = [],
): Record<string, string | null> {
  const painPoint = notes
    .map((n) => /Main pain point:\n([^\n]+)/.exec(n)?.[1]?.trim() ?? null)
    .find((p) => p) ?? null;
  return {
    first_name: lead.owner_name?.split(' ')[0] ?? null,
    business_name: lead.business_name,
    owner_name: lead.owner_name,
    audit_date: null,
    package_name: lead.package_tier ? packageLabel(lead.package_tier) : null,
    deal_value: lead.deal_value !== null ? formatCurrency(lead.deal_value) : null,
    contractor_name: contractorName,
    pain_point: painPoint,
    cal_link: null,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run` — all files.
Expected: PASS (existing 22 + new).

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/types/index.ts src/lib/templateVars.ts src/lib/templateVars.test.ts
git commit -m "feat: email domain types + template variable substitution"
git push
```

---

### Task 2: Migration 002 — seeds, Vault helpers, cron schedule

**Files:**
- Create: `supabase/migrations/002_email_automation.sql`

**Interfaces:**
- Produces: seeded default templates (5, `is_default=true`, `created_by=null`) and sequences (2); SQL functions `app_set_smtp_secret(uid uuid, secret text)`, `app_get_smtp_secret(uid uuid) returns text` (service_role only); Vault secret `cron_secret`; pg_cron job `check-sequences-daily` (06:00 UTC) POSTing to the `check-sequences` edge function with header `x-cron-secret`.
- Note: `email_templates.template_type` has a CHECK constraint; sequence `steps` is JSONB `[{"delay_days":n,"template_type":"...","subject_override":null}]`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/002_email_automation.sql`:

```sql
-- ─────────────────────────────────────────
-- CYCLE 2: email automation — seeds, vault helpers, cron
-- ─────────────────────────────────────────

-- 1. Default templates (visible to everyone via is_default RLS policy)
INSERT INTO email_templates (name, subject, body, template_type, is_default, created_by) VALUES
('Initial Follow-Up (48h)', 'Following up — {{business_name}}',
'Hi {{first_name}},

Thanks for taking my call — I know you''re busy running {{business_name}}, so I''ll keep this short.

We talked about {{pain_point}}. That''s exactly the kind of thing we fix at Dreamlabs, and I''d hate for it to keep costing you work.

Shall we get your free audit booked in? It takes 20 minutes and you''ll get value from it whether or not we work together.

{{cal_link}}

Speak soon,
{{contractor_name}}
Digital Influx Dreamlabs', 'initial_followup', true, NULL),

('Second Chase (7 days)', 'Quick check-in — {{business_name}}',
'Hi {{first_name}},

Just floating this back to the top of your inbox — no pressure at all.

If now isn''t the right time for {{business_name}}, tell me and I''ll stop nudging. If it is, my earlier email has everything you need to grab a slot.

Best,
{{contractor_name}}', 'second_chase', true, NULL),

('Not Now Nurture (30 days)', 'Checking back in — {{business_name}}',
'Hi {{first_name}},

You mentioned the timing wasn''t right, so I made a note to check back — this is that note.

No sales pitch: just letting you know we''re still here, still helping businesses like {{business_name}} win back hours every week. If anything''s changed, I''d love to hear how things are going either way.

All the best,
{{contractor_name}}', 'not_now_nurture', true, NULL),

('Audit Confirmation', 'Your Free Business Audit — confirmed for {{audit_date}}',
'Hi {{first_name}},

Great news — your free business audit is confirmed for {{audit_date}}.

What to expect: we''ll walk through how {{business_name}} handles enquiries, follow-ups and repeat work, and I''ll show you exactly where time and money are leaking. You''ll leave with an action list you can use with or without us.

Nothing to prepare. See you then!

{{contractor_name}}
Digital Influx Dreamlabs', 'audit_confirmation', true, NULL),

('Proposal Follow-Up', 'Your Dreamlabs proposal — {{business_name}}',
'Hi {{first_name}},

I wanted to check you''d had a chance to look over the proposal for {{business_name}} ({{package_name}}, {{deal_value}}).

Happy to walk through any part of it on a quick call — and if something doesn''t fit, we can adjust it. What questions can I answer?

Best,
{{contractor_name}}', 'proposal_followup', true, NULL);

-- 2. Default sequences (steps reference templates by template_type)
INSERT INTO email_sequences (name, description, steps, is_default, created_by) VALUES
('Proposal Follow-Up', 'Chase a sent proposal without being annoying.',
 '[{"delay_days":0,"template_type":"initial_followup","subject_override":null},
   {"delay_days":2,"template_type":"second_chase","subject_override":null},
   {"delay_days":7,"template_type":"proposal_followup","subject_override":null}]'::jsonb,
 true, NULL),
('Not Now Nurture', 'Stay warm with leads who said "not now".',
 '[{"delay_days":0,"template_type":"not_now_nurture","subject_override":null},
   {"delay_days":30,"template_type":"not_now_nurture","subject_override":null}]'::jsonb,
 true, NULL);

-- 3. Vault helpers for per-user SMTP secrets (service_role only)
CREATE OR REPLACE FUNCTION app_set_smtp_secret(uid uuid, secret text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'smtp_pass_' || uid::text;
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(secret, 'smtp_pass_' || uid::text);
  ELSE
    PERFORM vault.update_secret(existing_id, secret);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_get_smtp_secret(uid uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'smtp_pass_' || uid::text;
$$;

REVOKE ALL ON FUNCTION app_set_smtp_secret(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_get_smtp_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_set_smtp_secret(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION app_get_smtp_secret(uuid) TO service_role;

-- 4. Cron: daily sequence check at 06:00 UTC.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- One-off shared secret between cron and the edge function.
SELECT vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'cron_secret')
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret');

SELECT cron.schedule(
  'check-sequences-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/check-sequences',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 2: Apply the migration to the live DB**

Write the file's contents into `query.json` as `{"query":"<file contents>"}` (use `node -e` to JSON-encode safely):

```bash
cd /c/Users/kevin/Projects/dreamlabs-sales
node -e "const fs=require('fs');fs.writeFileSync('query.json',JSON.stringify({query:fs.readFileSync('supabase/migrations/002_email_automation.sql','utf8')}))"
export $(grep -E '^SUPABASE_ACCESS_TOKEN=' .env)
curl -s -X POST "https://api.supabase.com/v1/projects/wgomksxelyfkzepbnkdd/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d @query.json
rm query.json
```

Expected: `[]` or a success payload with no `"message"` error key. If pg_cron cannot be created via this endpoint, enable it first: `curl -s -X POST "https://api.supabase.com/v1/projects/wgomksxelyfkzepbnkdd/database/query" ... -d '{"query":"select 1"}'` then use the Supabase dashboard → Database → Extensions note in your report (do NOT silently skip).

- [ ] **Step 3: Verify seeds + cron + helpers**

Run (same curl runner) the query:
`select (select count(*) from email_templates where is_default) as tpl, (select count(*) from email_sequences where is_default) as seq, (select count(*) from cron.job where jobname = 'check-sequences-daily') as job, (select count(*) from vault.secrets where name = 'cron_secret') as secret;`
Expected: `[{"tpl":5,"seq":2,"job":1,"secret":1}]`.

- [ ] **Step 4: Set the function-side copy of the cron secret**

Read the secret once and store it in `.env` (gitignored) for later tasks, then set it as an edge-function secret:

```bash
# fetch: select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
# append to .env:  CRON_SECRET=<value>
npx supabase secrets set CRON_SECRET=<value>
```

Expected: secrets list shows CRON_SECRET. (GEMINI_API_KEY is handled in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/002_email_automation.sql
git commit -m "feat: migration 002 - template/sequence seeds, vault smtp helpers, sequence cron"
git push
```

---

### Task 3: SMTP shared module + `email-settings` edge function

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/smtp.ts`
- Create: `supabase/functions/email-settings/index.ts`

**Interfaces:**
- Consumes: `app_set_smtp_secret` / `app_get_smtp_secret` SQL functions (Task 2).
- Produces:
  - `_shared/cors.ts`: `corsHeaders(origin: string | null): Record<string, string>` and `json(body: unknown, status: number, headers: Record<string,string>): Response` (extracted verbatim from `admin-users`).
  - `_shared/smtp.ts`: `sendMail(cfg: { host: string; port: number; user: string; pass: string; fromName: string | null }, msg: { to: string; subject: string; body: string }): Promise<void>` (throws with a readable message on failure).
  - `email-settings` actions (POST, authed JWT): `{ action: 'save', provider, smtp_host, smtp_port, smtp_user, from_name, password? }` (password optional on re-save), `{ action: 'get' }` → settings row or null, `{ action: 'test' }` → sends a test email to the caller's own login email and sets `is_verified=true` on success.
- Provider presets (client fills these, function stores literal values): gmail → `smtp.gmail.com:465`, outlook → `smtp-mail.outlook.com:587`, yahoo → `smtp.mail.yahoo.com:465`, smtp → user-supplied.

- [ ] **Step 1: Write `_shared/cors.ts`**

```ts
const APP_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? 'http://localhost:5173').split(',');

/** CORS headers limited to the configured app origins (same policy as admin-users). */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && APP_ORIGINS.includes(origin) ? origin : APP_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

/** JSON response helper. */
export function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
```

- [ ] **Step 2: Write `_shared/smtp.ts`**

```ts
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.1/mod.ts';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string | null;
}

/** Sends one plain-text email. Port 465 = implicit TLS; anything else attempts STARTTLS. */
export async function sendMail(
  cfg: SmtpConfig,
  msg: { to: string; subject: string; body: string },
): Promise<void> {
  const client = new SMTPClient({
    connection: {
      hostname: cfg.host,
      port: cfg.port,
      tls: cfg.port === 465,
      auth: { username: cfg.user, password: cfg.pass },
    },
  });
  try {
    await client.send({
      from: cfg.fromName ? `${cfg.fromName} <${cfg.user}>` : cfg.user,
      to: msg.to,
      subject: msg.subject,
      content: msg.body,
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}
```

- [ ] **Step 3: Write `email-settings/index.ts`**

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { sendMail } from '../_shared/smtp.ts';

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const authHeader = req.headers.get('Authorization') ?? '';
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await anonClient.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'Not signed in' }, 401, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const body = (await req.json()) as Record<string, unknown>;

  if (body.action === 'get') {
    const { data } = await service
      .from('user_email_settings').select('*').eq('user_id', user.id).maybeSingle();
    return json({ settings: data }, 200, headers);
  }

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
    if (upsertErr) return json({ error: upsertErr.message }, 400, headers);

    if (password) {
      const { error: vaultErr } = await service.rpc('app_set_smtp_secret', { uid: user.id, secret: password });
      if (vaultErr) return json({ error: 'Could not store password: ' + vaultErr.message }, 500, headers);
    }
    return json({ ok: true }, 200, headers);
  }

  if (body.action === 'test') {
    const { data: settings } = await service
      .from('user_email_settings').select('*').eq('user_id', user.id).maybeSingle();
    if (!settings) return json({ error: 'Save your email settings first' }, 400, headers);
    const { data: pass } = await service.rpc('app_get_smtp_secret', { uid: user.id });
    if (!pass) return json({ error: 'No password stored — re-save your settings including the password' }, 400, headers);
    try {
      await sendMail(
        { host: settings.smtp_host, port: settings.smtp_port, user: settings.smtp_user, pass: pass as string, fromName: settings.from_name },
        { to: user.email!, subject: 'Dreamlabs Sales — test email', body: 'Your email settings work. Happy selling!\n\n— Dreamlabs Sales' },
      );
    } catch (e) {
      return json({ error: 'Send failed: ' + (e instanceof Error ? e.message : String(e)) }, 400, headers);
    }
    await service.from('user_email_settings').update({ is_verified: true }).eq('user_id', user.id);
    return json({ ok: true }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
```

- [ ] **Step 4: Deploy + smoke test**

```bash
cd /c/Users/kevin/Projects/dreamlabs-sales
npx supabase functions deploy email-settings
```

Smoke test with Kevin's session (sign in via REST to get a JWT — `KEVIN_APP_PASSWORD` and `VITE_SUPABASE_*` are in `.env`):

```bash
# POST /auth/v1/token?grant_type=password with kevindigitalinflux@gmail.com → access_token
# then:
curl -s -X POST "https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/email-settings" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"action":"get"}'
```

Expected: `{"settings":null}` (Kevin hasn't configured yet). Do NOT test 'save'/'test' here — real credentials arrive via the UI in Task 4 (human step).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared supabase/functions/email-settings
git commit -m "feat: email-settings edge function - vault-backed smtp config + test send"
git push
```

---

### Task 4: `/settings/email` config UI

**Files:**
- Create: `src/hooks/useEmailSettings.ts`
- Create: `src/pages/EmailConfig.tsx`
- Modify: `src/App.tsx` (add route `/settings/email`)
- Modify: `src/pages/Settings.tsx` (add a link card to `/settings/email`)

**Interfaces:**
- Consumes: `email-settings` function actions (Task 3); `UserEmailSettings`, `EmailProvider` types (Task 1); UI primitives.
- Produces: `useEmailSettings(): { settings: UserEmailSettings | null; loading: boolean; save(input: SaveInput): Promise<string | null>; sendTest(): Promise<string | null> }` where `SaveInput = { provider: EmailProvider; smtp_host: string; smtp_port: number; smtp_user: string; from_name: string; password: string }` (empty password = keep existing).

- [ ] **Step 1: Write `src/hooks/useEmailSettings.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { EmailProvider, UserEmailSettings } from '../types';

export interface SaveInput {
  provider: EmailProvider;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  from_name: string;
  password: string;
}

/** SMTP settings via the email-settings edge function (credentials never touch the client DB API). */
export function useEmailSettings() {
  const [settings, setSettings] = useState<UserEmailSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('email-settings', { body: { action: 'get' } });
    if (!error) setSettings((data as { settings: UserEmailSettings | null }).settings);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (input: SaveInput): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke('email-settings', {
      body: { action: 'save', ...input, password: input.password || undefined },
    });
    if (error) return error.message;
    const err = (data as { error?: string }).error;
    if (err) return err;
    await refresh();
    return null;
  }, [refresh]);

  const sendTest = useCallback(async (): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke('email-settings', { body: { action: 'test' } });
    if (error) return error.message;
    const err = (data as { error?: string }).error;
    if (err) return err;
    await refresh();
    return null;
  }, [refresh]);

  return { settings, loading, save, sendTest };
}
```

- [ ] **Step 2: Write `src/pages/EmailConfig.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { CheckCircle2, Mail } from 'lucide-react';
import { useEmailSettings } from '../hooks/useEmailSettings';
import type { SaveInput } from '../hooks/useEmailSettings';
import type { EmailProvider } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, SelectField } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';

const PRESETS: Record<EmailProvider, { host: string; port: number }> = {
  gmail: { host: 'smtp.gmail.com', port: 465 },
  outlook: { host: 'smtp-mail.outlook.com', port: 587 },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465 },
  smtp: { host: '', port: 587 },
};

const GMAIL_STEPS = [
  'Go to your Google Account → Security → turn ON 2-Step Verification (required).',
  'Search "App Passwords" in your Google Account settings.',
  'Create a new App Password — name it "Dreamlabs Sales".',
  'Paste the 16-character password below.',
];
const OUTLOOK_STEPS = [
  'Use your full Outlook/Hotmail address as the SMTP username.',
  'If you have 2-step verification, create an app password at account.microsoft.com → Security.',
  'Otherwise your normal password usually works. Paste it below.',
];

/** SMTP config wizard (SPEC.md §7 Email Config) — non-technical, provider-guided. */
export function EmailConfig() {
  const { settings, loading, save, sendTest } = useEmailSettings();
  const [form, setForm] = useState<SaveInput>({ provider: 'gmail', smtp_host: PRESETS.gmail.host, smtp_port: PRESETS.gmail.port, smtp_user: '', from_name: '', password: '' });
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (settings) {
      setForm((f) => ({ ...f, provider: settings.provider, smtp_host: settings.smtp_host ?? '', smtp_port: settings.smtp_port, smtp_user: settings.smtp_user ?? '', from_name: settings.from_name ?? '' }));
    }
  }, [settings]);

  function pickProvider(p: EmailProvider) {
    setForm((f) => ({ ...f, provider: p, smtp_host: PRESETS[p].host || f.smtp_host, smtp_port: PRESETS[p].port }));
  }

  async function handleSave() {
    setBusy('save'); setMsg(null);
    const err = await save(form);
    setBusy(null);
    setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Settings saved. Now send yourself a test email.' });
    if (!err) setForm((f) => ({ ...f, password: '' }));
  }
  async function handleTest() {
    setBusy('test'); setMsg(null);
    const err = await sendTest();
    setBusy(null);
    setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Test email sent — check your inbox!' });
  }

  if (loading) return <Skeleton className="h-80 w-full max-w-2xl" />;
  const steps = form.provider === 'gmail' ? GMAIL_STEPS : form.provider === 'outlook' ? OUTLOOK_STEPS : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <h1 className="text-[28px] font-extrabold">Email sending</h1>
        {settings?.is_verified && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Verified
          </span>
        )}
      </header>
      <p className="text-muted">Connect your own email address — everything you send goes out from it, not from a robot address.</p>

      <Card>
        <div className="flex flex-col gap-4">
          <SelectField label="Your email provider" value={form.provider} onChange={(e) => pickProvider(e.target.value as EmailProvider)}>
            <option value="gmail">Gmail / Google Workspace</option>
            <option value="outlook">Outlook / Hotmail</option>
            <option value="yahoo">Yahoo</option>
            <option value="smtp">Other (custom SMTP)</option>
          </SelectField>

          {steps.length > 0 && (
            <ol className="flex flex-col gap-2 rounded-lg bg-surface/60 p-4 text-sm">
              {steps.map((s, i) => (
                <li key={s} className="flex gap-2"><span className="font-bold text-cyan">{i + 1}.</span>{s}</li>
              ))}
            </ol>
          )}

          <Input label="Your email address" type="email" value={form.smtp_user} onChange={(e) => setForm((f) => ({ ...f, smtp_user: e.target.value }))} placeholder="you@example.com" />
          <Input label={form.provider === 'gmail' ? 'App password (16 characters)' : 'Password / app password'} type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder={settings ? 'Leave blank to keep the current password' : ''} />
          <Input label="From name (how recipients see you)" value={form.from_name} onChange={(e) => setForm((f) => ({ ...f, from_name: e.target.value }))} placeholder="e.g. Kevin at Dreamlabs" />

          {form.provider === 'smtp' && (
            <div className="flex gap-2">
              <Input label="SMTP host" value={form.smtp_host} onChange={(e) => setForm((f) => ({ ...f, smtp_host: e.target.value }))} />
              <Input label="Port" type="number" value={String(form.smtp_port)} onChange={(e) => setForm((f) => ({ ...f, smtp_port: Number(e.target.value) || 587 }))} />
            </div>
          )}

          {msg && <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>}

          <div className="flex items-center justify-between">
            <Button onClick={() => void handleSave()} disabled={busy !== null}>{busy === 'save' ? 'Saving…' : 'Save settings'}</Button>
            <Button variant="secondary" onClick={() => void handleTest()} disabled={busy !== null || !settings}>
              <Mail className="h-4 w-4" aria-hidden />
              {busy === 'test' ? 'Sending…' : 'Send test email'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Wire the route + settings link**

In `src/App.tsx` add `import { EmailConfig } from './pages/EmailConfig';` and, next to the existing `/settings` route: `<Route path="/settings/email" element={<EmailConfig />} />`.

In `src/pages/Settings.tsx` add a linked Card (follow the page's existing markup style):

```tsx
<Link to="/settings/email" className="block rounded-xl border border-line bg-card p-5 hover:bg-surface/50">
  <h2 className="text-[18px] font-bold">Email sending</h2>
  <p className="text-sm text-muted">Connect your Gmail/Outlook so Dreamlabs Sales can send from your address.</p>
</Link>
```

(`import { Link } from 'react-router';` if not present.)

- [ ] **Step 4: Verify in browser**

1. `/settings` shows the "Email sending" card → click → `/settings/email`.
2. Provider dropdown swaps the instruction steps (Gmail 4 steps, Outlook 3, Yahoo/custom none) and presets host/port; custom shows host/port inputs.
3. Typecheck + tests pass: `npx tsc --noEmit && npx vitest run`.
4. **HUMAN STEP (Kevin):** enter a real Gmail app password, Save, then "Send test email" → Verified badge appears and a test email lands in his inbox. The task is complete when the UI works and typechecks; note the pending human step in your report.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useEmailSettings.ts src/pages/EmailConfig.tsx src/App.tsx src/pages/Settings.tsx
git commit -m "feat: email config page - provider wizard, vault-backed save, test send"
git push
```

---

### Task 5: Emails hub shell + Templates tab

**Files:**
- Create: `src/hooks/useTemplates.ts`
- Create: `src/pages/EmailsHub.tsx`
- Create: `src/components/emails/TemplateList.tsx`
- Create: `src/components/emails/TemplateEditor.tsx`
- Modify: `src/App.tsx` (replace `/emails/*` ComingSoon with the hub)

**Interfaces:**
- Consumes: `EmailTemplate`, `TemplateType` (Task 1); `TEMPLATE_VARIABLES`, `substituteVariables`, `buildTemplateVars` (Task 1); `useAuth` (`profile.role`, `profile.full_name`); UI primitives; direct supabase table access (RLS handles visibility).
- Produces:
  - `useTemplates(): { templates: EmailTemplate[]; loading: boolean; error: string | null; save(t: TemplateInput, id?: string): Promise<string | null>; remove(id: string): Promise<string | null> }` with `TemplateInput = { name: string; subject: string; body: string; is_default: boolean }` (new templates get `template_type: 'custom'`, `created_by = auth user`).
  - `EmailsHub` renders tabs Templates / Sequences / Logs from `?tab=` search param (default `templates`). Sequences and Logs render `<ComingSoon module="..."/>` placeholders until Tasks 7/11 replace them.
  - `TemplateEditor({ template: EmailTemplate | null, onSave, onClose })` — modal editor; insert-variable buttons append `{{key}}` at the cursor; live preview panel substitutes against a hardcoded sample lead.

- [ ] **Step 1: Write `src/hooks/useTemplates.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { EmailTemplate } from '../types';

export interface TemplateInput {
  name: string;
  subject: string;
  body: string;
  is_default: boolean;
}

/** Email templates (defaults + own). RLS scopes visibility; admin may toggle is_default. */
export function useTemplates() {
  const { session } = useAuth();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('email_templates').select('*').order('is_default', { ascending: false }).order('name');
    if (err) setError(err.message);
    else { setTemplates(data as EmailTemplate[]); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (t: TemplateInput, id?: string): Promise<string | null> => {
    const { error: err } = id
      ? await supabase.from('email_templates').update(t).eq('id', id)
      : await supabase.from('email_templates').insert({ ...t, template_type: 'custom', created_by: session?.user.id });
    if (err) return err.message;
    await refresh();
    return null;
  }, [refresh, session]);

  const remove = useCallback(async (id: string): Promise<string | null> => {
    const { error: err } = await supabase.from('email_templates').delete().eq('id', id);
    if (err) return err.message;
    await refresh();
    return null;
  }, [refresh]);

  return { templates, loading, error, save, remove };
}
```

- [ ] **Step 2: Write `src/pages/EmailsHub.tsx`**

```tsx
import { useSearchParams } from 'react-router';
import { ComingSoon } from '../components/layout/ComingSoon';
import { TemplateList } from '../components/emails/TemplateList';

const TABS = [
  { key: 'templates', label: 'Templates' },
  { key: 'sequences', label: 'Sequences' },
  { key: 'logs', label: 'Logs' },
] as const;

/** /emails — templates / sequences / logs tabs (SPEC.md §13 routes collapsed to one hub). */
export function EmailsHub() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'templates';
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-extrabold">Emails</h1>
      <div className="flex overflow-hidden rounded-lg border border-line self-start" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            onClick={() => setParams({ tab: t.key })}
            className={`min-h-11 cursor-pointer px-5 text-sm font-semibold ${tab === t.key ? 'bg-violet/25 text-offwhite' : 'text-muted hover:text-offwhite'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'templates' && <TemplateList />}
      {tab === 'sequences' && <ComingSoon module="Sequences" />}
      {tab === 'logs' && <ComingSoon module="Email logs" />}
    </div>
  );
}
```

In `src/App.tsx`: `import { EmailsHub } from './pages/EmailsHub';` and replace the `/emails/*` ComingSoon route with `<Route path="/emails" element={<EmailsHub />} />` (keep a `/emails/*` → `<EmailsHub />` catch too so old links land on the hub).

- [ ] **Step 3: Write `src/components/emails/TemplateList.tsx`**

```tsx
import { useState } from 'react';
import { FileText, Plus, Star } from 'lucide-react';
import { useTemplates } from '../../hooks/useTemplates';
import { useAuth } from '../../hooks/useAuth';
import type { EmailTemplate } from '../../types';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { TemplateEditor } from './TemplateEditor';

/** Template library: defaults first, then own; click to edit (own or admin), New to create. */
export function TemplateList() {
  const { templates, loading, error, save, remove } = useTemplates();
  const { profile, session } = useAuth();
  const [editing, setEditing] = useState<EmailTemplate | null | 'new'>(null);

  const canEdit = (t: EmailTemplate) => profile?.role === 'admin' || t.created_by === session?.user.id;

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) return <p role="alert" className="text-sm text-red-400">{error}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="self-end">
        <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden />New template</Button>
      </div>
      {templates.length === 0 && <EmptyState icon={FileText} title="No templates yet" hint="Create your first template to draft emails faster." />}
      <ul className="grid gap-3 md:grid-cols-2">
        {templates.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => canEdit(t) ? setEditing(t) : undefined}
              className={`w-full rounded-xl border border-line bg-card p-4 text-left ${canEdit(t) ? 'cursor-pointer hover:bg-surface/50' : 'cursor-default'}`}>
              <div className="flex items-center gap-2">
                <span className="font-heading text-sm font-bold">{t.name}</span>
                {t.is_default && <Star className="h-3.5 w-3.5 text-amber-400" aria-label="Default template" />}
              </div>
              <p className="mt-1 truncate text-sm text-muted">{t.subject}</p>
              <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs text-muted">{t.body}</p>
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <TemplateEditor
          template={editing === 'new' ? null : editing}
          isAdmin={profile?.role === 'admin'}
          onSave={(input, id) => save(input, id)}
          onDelete={(id) => remove(id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write `src/components/emails/TemplateEditor.tsx`**

```tsx
import { useRef, useState } from 'react';
import { substituteVariables, TEMPLATE_VARIABLES } from '../../lib/templateVars';
import type { TemplateInput } from '../../hooks/useTemplates';
import type { EmailTemplate } from '../../types';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';

const SAMPLE_VARS: Record<string, string> = {
  first_name: 'Ana', business_name: 'Shiny Cleaners', owner_name: 'Ana Diaz',
  audit_date: 'Tuesday 22 July, 10:00', package_name: 'Automation Sprint',
  deal_value: '£4,500', contractor_name: 'Kevin', pain_point: 'missed after-hours calls',
  cal_link: 'https://cal.com/dreamlabs/audit',
};

interface TemplateEditorProps {
  template: EmailTemplate | null;
  isAdmin: boolean;
  onSave: (input: TemplateInput, id?: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onClose: () => void;
}

/** Modal template editor with variable-insert buttons + live sample preview. */
export function TemplateEditor({ template, isAdmin, onSave, onDelete, onClose }: TemplateEditorProps) {
  const [form, setForm] = useState<TemplateInput>({
    name: template?.name ?? '', subject: template?.subject ?? '',
    body: template?.body ?? '', is_default: template?.is_default ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function insertVar(key: string) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return setForm((f) => ({ ...f, body: f.body + token }));
    const pos = el.selectionStart ?? form.body.length;
    setForm((f) => ({ ...f, body: f.body.slice(0, pos) + token + f.body.slice(pos) }));
  }

  async function handleSave() {
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) return setError('Name, subject and body are all required.');
    setBusy(true);
    const err = await onSave(form, template?.id);
    setBusy(false);
    if (err) return setError(err);
    onClose();
  }
  async function handleDelete() {
    if (!template) return;
    setBusy(true);
    const err = await onDelete(template.id);
    setBusy(false);
    if (err) return setError(err);
    onClose();
  }

  const preview = substituteVariables(form.body, SAMPLE_VARS).text;

  return (
    <Modal open onClose={onClose} title={template ? `Edit — ${template.name}` : 'New template'}>
      <div className="flex flex-col gap-4">
        <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Input label="Subject" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
        <div className="flex flex-wrap gap-1">
          {TEMPLATE_VARIABLES.map((v) => (
            <button key={v.key} type="button" onClick={() => insertVar(v.key)}
              className="cursor-pointer rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-cyan hover:text-cyan">
              {v.label}
            </button>
          ))}
        </div>
        <Textarea ref={bodyRef} label="Body" rows={8} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))} className="h-4 w-4 accent-violet-500" />
            Default template (visible to all contractors)
          </label>
        )}
        <div className="rounded-lg bg-surface/60 p-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Preview (sample lead)</p>
          <p className="whitespace-pre-wrap text-sm">{preview}</p>
        </div>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center justify-between">
          {template && !template.is_default ? (
            <Button variant="ghost" onClick={() => void handleDelete()} disabled={busy}>Delete</Button>
          ) : <span />}
          <Button onClick={() => void handleSave()} disabled={busy}>{busy ? 'Saving…' : 'Save template'}</Button>
        </div>
      </div>
    </Modal>
  );
}
```

Note: `Textarea` must accept a ref. If `src/components/ui/Input.tsx`'s `Textarea` doesn't forward refs, update it to use `React.forwardRef` (keep its existing props/markup identical otherwise).

- [ ] **Step 5: Verify in browser + commit**

1. `/emails` → Templates tab: the 5 seeded defaults show with star badges; Sequences/Logs tabs show ComingSoon.
2. New template → insert variables via buttons → preview substitutes sample values live → Save → appears in the grid.
3. Edit the custom template → change subject → Save. Delete it → gone. (Defaults: editable only as admin, no delete button.)
4. `npx tsc --noEmit && npx vitest run` pass.

```bash
git add src/hooks/useTemplates.ts src/pages/EmailsHub.tsx src/components/emails src/App.tsx src/components/ui/Input.tsx
git commit -m "feat: emails hub with template library, editor, variable insertion, live preview"
git push
```

---

### Task 6: Sequence schedule math (TDD)

**Files:**
- Create: `src/lib/sequenceMath.ts`
- Test: `src/lib/sequenceMath.test.ts`

**Interfaces:**
- Consumes: `SequenceStep`, `SequenceEnrollment`, `EnrollmentStatus` (Task 1).
- Produces (used by Task 12 UI and Task 13 cron):
  - `nextSendAtFor(start: Date, steps: SequenceStep[], stepNumber: number): string | null` — ISO time the given 1-based step becomes due (start + sum of delay_days from steps[0..stepNumber-1]); null if stepNumber exceeds steps.
  - `advanceEnrollment(enrollment: Pick<SequenceEnrollment, 'current_step'>, steps: SequenceStep[], now: Date): { current_step: number; next_send_at: string | null; status: EnrollmentStatus }` — after drafting the current step: moves to the next step (`now + next step's delay_days`), or completes.
  - `timelineLabel(steps: SequenceStep[]): string` — `"Day 0 → Day 2 → Day 9"` cumulative labels.

- [ ] **Step 1: Write the failing tests**

`src/lib/sequenceMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { advanceEnrollment, nextSendAtFor, timelineLabel } from './sequenceMath';
import type { SequenceStep } from '../types';

const steps: SequenceStep[] = [
  { delay_days: 0, template_type: 'initial_followup', subject_override: null },
  { delay_days: 2, template_type: 'second_chase', subject_override: null },
  { delay_days: 7, template_type: 'proposal_followup', subject_override: null },
];
const T0 = new Date('2026-07-17T06:00:00Z');

describe('nextSendAtFor', () => {
  it('step 1 due at start + its own delay', () => {
    expect(nextSendAtFor(T0, steps, 1)).toBe('2026-07-17T06:00:00.000Z');
  });
  it('step 2 due at cumulative delay', () => {
    expect(nextSendAtFor(T0, steps, 2)).toBe('2026-07-19T06:00:00.000Z');
  });
  it('step 3 cumulative 0+2+7 = day 9', () => {
    expect(nextSendAtFor(T0, steps, 3)).toBe('2026-07-26T06:00:00.000Z');
  });
  it('null beyond the last step', () => {
    expect(nextSendAtFor(T0, steps, 4)).toBeNull();
  });
});

describe('advanceEnrollment', () => {
  it('moves to the next step, due now + its delay', () => {
    const r = advanceEnrollment({ current_step: 1 }, steps, T0);
    expect(r).toEqual({ current_step: 2, next_send_at: '2026-07-19T06:00:00.000Z', status: 'active' });
  });
  it('completes after the last step', () => {
    const r = advanceEnrollment({ current_step: 3 }, steps, T0);
    expect(r).toEqual({ current_step: 3, next_send_at: null, status: 'completed' });
  });
});

describe('timelineLabel', () => {
  it('renders cumulative day markers', () => {
    expect(timelineLabel(steps)).toBe('Day 0 → Day 2 → Day 9');
  });
  it('empty steps', () => {
    expect(timelineLabel([])).toBe('No steps yet');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/sequenceMath.test.ts`
Expected: FAIL — cannot find module './sequenceMath'.

- [ ] **Step 3: Write `src/lib/sequenceMath.ts`**

```ts
import type { EnrollmentStatus, SequenceEnrollment, SequenceStep } from '../types';

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Cumulative delay (days) from enrollment start until the given 1-based step. */
function cumulativeDays(steps: SequenceStep[], stepNumber: number): number {
  return steps.slice(0, stepNumber).reduce((sum, s) => sum + s.delay_days, 0);
}

/** ISO due time for a 1-based step, or null when past the last step. */
export function nextSendAtFor(start: Date, steps: SequenceStep[], stepNumber: number): string | null {
  if (stepNumber < 1 || stepNumber > steps.length) return null;
  return addDays(start, cumulativeDays(steps, stepNumber)).toISOString();
}

/** State after drafting the current step: advance or complete. */
export function advanceEnrollment(
  enrollment: Pick<SequenceEnrollment, 'current_step'>,
  steps: SequenceStep[],
  now: Date,
): { current_step: number; next_send_at: string | null; status: EnrollmentStatus } {
  const next = enrollment.current_step + 1;
  if (next > steps.length) {
    return { current_step: enrollment.current_step, next_send_at: null, status: 'completed' };
  }
  return { current_step: next, next_send_at: addDays(now, steps[next - 1]!.delay_days).toISOString(), status: 'active' };
}

/** "Day 0 → Day 2 → Day 9" preview strip for the builder. */
export function timelineLabel(steps: SequenceStep[]): string {
  if (steps.length === 0) return 'No steps yet';
  let total = 0;
  return steps.map((s) => { total += s.delay_days; return `Day ${total}`; }).join(' → ');
}
```

- [ ] **Step 4: Run tests to verify they pass, then commit**

Run: `npx vitest run` — all green.

```bash
git add src/lib/sequenceMath.ts src/lib/sequenceMath.test.ts
git commit -m "feat: sequence schedule math with tests"
git push
```

---

### Task 7: Sequences tab — library + builder + timeline

**Files:**
- Create: `src/hooks/useSequences.ts`
- Create: `src/components/emails/SequenceList.tsx`
- Create: `src/components/emails/SequenceBuilder.tsx`
- Modify: `src/pages/EmailsHub.tsx` (replace Sequences ComingSoon)

**Interfaces:**
- Consumes: `EmailSequence`, `SequenceStep`, `TemplateType` (Task 1); `timelineLabel` (Task 6); `useTemplates` (Task 5) for the step template dropdown; dnd-kit (already a dependency — see `KanbanBoard.tsx` for the project's usage pattern).
- Produces: `useSequences(): { sequences: EmailSequence[]; loading; error; save(input: SequenceInput, id?): Promise<string | null>; remove(id): Promise<string | null> }` with `SequenceInput = { name: string; description: string | null; steps: SequenceStep[]; is_default: boolean }`.

- [ ] **Step 1: Write `src/hooks/useSequences.ts`** — mirror `useTemplates` exactly against the `email_sequences` table (same shape: refresh/save/remove, insert adds `created_by: session?.user.id`):

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { EmailSequence, SequenceStep } from '../types';

export interface SequenceInput {
  name: string;
  description: string | null;
  steps: SequenceStep[];
  is_default: boolean;
}

/** Email sequences (defaults + own), RLS-scoped like templates. */
export function useSequences() {
  const { session } = useAuth();
  const [sequences, setSequences] = useState<EmailSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('email_sequences').select('*').order('is_default', { ascending: false }).order('name');
    if (err) setError(err.message);
    else { setSequences(data as EmailSequence[]); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (input: SequenceInput, id?: string): Promise<string | null> => {
    const { error: err } = id
      ? await supabase.from('email_sequences').update(input).eq('id', id)
      : await supabase.from('email_sequences').insert({ ...input, created_by: session?.user.id });
    if (err) return err.message;
    await refresh();
    return null;
  }, [refresh, session]);

  const remove = useCallback(async (id: string): Promise<string | null> => {
    const { error: err } = await supabase.from('email_sequences').delete().eq('id', id);
    if (err) return err.message;
    await refresh();
    return null;
  }, [refresh]);

  return { sequences, loading, error, save, remove };
}
```

- [ ] **Step 2: Write `src/components/emails/SequenceList.tsx`** — same layout pattern as `TemplateList` (grid of cards, star for defaults, New button, admin/own edit gating), with each card showing `sequence.name`, `sequence.description`, step count, and `timelineLabel(sequence.steps)` in `text-xs text-cyan`. Clicking an editable card opens `SequenceBuilder`; the New button opens it with `sequence: null`. Reuse the exact `canEdit` logic from `TemplateList`.

- [ ] **Step 3: Write `src/components/emails/SequenceBuilder.tsx`**

```tsx
import { useState } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { timelineLabel } from '../../lib/sequenceMath';
import { useTemplates } from '../../hooks/useTemplates';
import type { SequenceInput } from '../../hooks/useSequences';
import type { EmailSequence, SequenceStep, TemplateType } from '../../types';
import { Button } from '../ui/Button';
import { Input, SelectField } from '../ui/Input';
import { Modal } from '../ui/Modal';

interface SequenceBuilderProps {
  sequence: EmailSequence | null;
  isAdmin: boolean;
  onSave: (input: SequenceInput, id?: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onClose: () => void;
}

function StepCard({ index, step, templates, onChange, onRemove }: {
  index: number;
  step: SequenceStep;
  templates: { template_type: TemplateType; name: string }[];
  onChange: (patch: Partial<SequenceStep>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: `step-${index}` });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex items-end gap-2 rounded-lg border border-line bg-surface/40 p-3">
      <button type="button" {...attributes} {...listeners} aria-label="Reorder step" className="mb-2 cursor-grab text-muted"><GripVertical className="h-4 w-4" aria-hidden /></button>
      <div className="w-24">
        <Input label={index === 0 ? 'Start after (days)' : 'Wait (days)'} type="number" min="0" value={String(step.delay_days)}
          onChange={(e) => onChange({ delay_days: Math.max(0, Number(e.target.value) || 0) })} />
      </div>
      <div className="flex-1">
        <SelectField label="Template" value={step.template_type} onChange={(e) => onChange({ template_type: e.target.value as TemplateType })}>
          {templates.map((t) => <option key={t.template_type} value={t.template_type}>{t.name}</option>)}
        </SelectField>
      </div>
      <button type="button" onClick={onRemove} aria-label="Remove step" className="mb-1 flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-red-400"><Trash2 className="h-4 w-4" aria-hidden /></button>
    </li>
  );
}

/** Sequence builder: named steps with day delays, drag-reorder, timeline preview. */
export function SequenceBuilder({ sequence, isAdmin, onSave, onDelete, onClose }: SequenceBuilderProps) {
  const { templates } = useTemplates();
  const defaultTemplates = templates.filter((t) => t.is_default && t.template_type !== 'custom')
    .map((t) => ({ template_type: t.template_type, name: t.name }));
  const [form, setForm] = useState<SequenceInput>({
    name: sequence?.name ?? '', description: sequence?.description ?? null,
    steps: sequence?.steps ?? [], is_default: sequence?.is_default ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setStep(i: number, patch: Partial<SequenceStep>) {
    setForm((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  }
  function addStep() {
    setForm((f) => ({ ...f, steps: [...f.steps, { delay_days: f.steps.length === 0 ? 0 : 2, template_type: 'initial_followup', subject_override: null }] }));
  }
  function handleDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = Number(String(e.active.id).replace('step-', ''));
    const to = Number(String(e.over.id).replace('step-', ''));
    setForm((f) => ({ ...f, steps: arrayMove(f.steps, from, to) }));
  }
  async function handleSave() {
    if (!form.name.trim()) return setError('Give the sequence a name.');
    if (form.steps.length === 0) return setError('Add at least one step.');
    setBusy(true);
    const err = await onSave(form, sequence?.id);
    setBusy(false);
    if (err) return setError(err);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={sequence ? `Edit — ${sequence.name}` : 'New sequence'}>
      <div className="flex flex-col gap-4">
        <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Input label="Description (optional)" value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value || null }))} />
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={form.steps.map((_, i) => `step-${i}`)} strategy={verticalListSortingStrategy}>
            <ol className="flex flex-col gap-2">
              {form.steps.map((s, i) => (
                <StepCard key={`step-${i}`} index={i} step={s} templates={defaultTemplates}
                  onChange={(patch) => setStep(i, patch)}
                  onRemove={() => setForm((f) => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        <Button variant="secondary" onClick={addStep}><Plus className="h-4 w-4" aria-hidden />Add step</Button>
        <p className="rounded-lg bg-surface/60 p-3 text-sm font-semibold text-cyan">{timelineLabel(form.steps)}</p>
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))} className="h-4 w-4 accent-violet-500" />
            Default sequence (visible to all contractors)
          </label>
        )}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center justify-between">
          {sequence && !sequence.is_default ? <Button variant="ghost" onClick={() => { setBusy(true); void onDelete(sequence.id).then((err) => { setBusy(false); if (err) setError(err); else onClose(); }); }} disabled={busy}>Delete</Button> : <span />}
          <Button onClick={() => void handleSave()} disabled={busy}>{busy ? 'Saving…' : 'Save sequence'}</Button>
        </div>
      </div>
    </Modal>
  );
}
```

Note: steps reference templates by `template_type`, so the dropdown lists only the 5 seeded defaults (custom templates are excluded from sequences this cycle — matches the seed format and keeps the cron resolver simple).

- [ ] **Step 4: Replace the Sequences ComingSoon in `EmailsHub.tsx`** with `<SequenceList />` (import it).

- [ ] **Step 5: Verify in browser + commit**

1. Sequences tab: the 2 seeded sequences show with timeline labels ("Day 0 → Day 2 → Day 9" and "Day 0 → Day 30").
2. New sequence → add 2 steps → drag to reorder (mouse) → timeline updates → Save → card appears.
3. `npx tsc --noEmit && npx vitest run` pass.

```bash
git add src/hooks/useSequences.ts src/components/emails/SequenceList.tsx src/components/emails/SequenceBuilder.tsx src/pages/EmailsHub.tsx
git commit -m "feat: sequence library + builder with drag-reorder and timeline preview"
git push
```

---

### Task 8: `_shared/ai.ts` (Gemini) + `generate-email` edge function

**Files:**
- Create: `supabase/functions/_shared/ai.ts`
- Create: `supabase/functions/_shared/templateVars.ts` (Deno copy — see step 2)
- Create: `supabase/functions/generate-email/index.ts`

**Interfaces:**
- Consumes: `corsHeaders`/`json` (Task 3); template/sequence tables.
- Produces:
  - `_shared/ai.ts`: `draftEmail(input: { subject: string; body: string; lead: Record<string, unknown>; notes: string[]; contractorName: string }): Promise<{ subject: string; body: string }>` and `parseNotes(input: { note: string; lead: Record<string, unknown> }): Promise<Record<string, unknown>>`. Both call `gemini-2.5-flash` REST with `GEMINI_API_KEY` env; both THROW on any failure (caller decides fallback). Model name in one exported const `AI_MODEL = 'gemini-2.5-flash'`.
  - `generate-email` (POST, authed): `{ lead_id: string, template_id: string, use_ai?: boolean }` → `{ subject, body, ai_used: boolean, missing: string[] }`. Data is fetched with the CALLER's JWT client (RLS enforces lead visibility). On AI failure → plain substitution with `ai_used: false`.

- [ ] **Step 1: Write `_shared/ai.ts`**

```ts
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const AI_MODEL = 'gemini-2.5-flash';

async function geminiJson(prompt: string): Promise<unknown> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  const res = await fetch(`${GEMINI_URL}/${AI_MODEL}:generateContent?key=${key}`, {
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

/** Personalises an already-variable-substituted draft using lead context + notes. Throws on failure. */
export async function draftEmail(input: {
  subject: string; body: string; lead: Record<string, unknown>; notes: string[]; contractorName: string;
}): Promise<{ subject: string; body: string }> {
  const result = await geminiJson(
`You are a sales assistant for Digital Influx Dreamlabs, a UK agency selling automation/AI systems to small businesses.
Personalise this follow-up email using the lead data and call notes. Keep it plain text, warm, brief, UK English.
Do not invent facts not present in the data. Keep any URLs intact. Return JSON: {"subject": string, "body": string}.

LEAD: ${JSON.stringify(input.lead)}
RECENT CALL NOTES (newest first): ${JSON.stringify(input.notes)}
SENDER NAME: ${input.contractorName}
DRAFT SUBJECT: ${input.subject}
DRAFT BODY:
${input.body}`,
  ) as { subject?: string; body?: string };
  if (!result.subject || !result.body) throw new Error('Gemini draft missing fields');
  return { subject: result.subject, body: result.body };
}

/** Suggests lead field updates from a note. Throws on failure. */
export async function parseNotes(input: { note: string; lead: Record<string, unknown> }): Promise<Record<string, unknown>> {
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
  ) as Record<string, unknown>;
}
```

- [ ] **Step 2: Create the Deno copy of the substitution helpers**

Copy `src/lib/templateVars.ts`'s `substituteVariables` and `buildTemplateVars` into `supabase/functions/_shared/templateVars.ts`, replacing the two web imports: inline `formatCurrency` as `(n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)` (verify against `src/lib/utils.ts` and copy its exact formatting), inline `packageLabel` with the `PACKAGE_TIERS` array copied from `src/lib/utils.ts`, and type `lead` as `Record<string, unknown>` with explicit field reads. Keep the function signatures identical so the logic stays recognisably the same module. Add a header comment: `// Deno copy of src/lib/templateVars.ts — keep the two in sync.`

- [ ] **Step 3: Write `generate-email/index.ts`**

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { draftEmail } from '../_shared/ai.ts';
import { buildTemplateVars, substituteVariables } from '../_shared/templateVars.ts';

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

  const body = (await req.json()) as { lead_id?: string; template_id?: string; use_ai?: boolean };
  if (!body.lead_id || !body.template_id) return json({ error: 'lead_id and template_id required' }, 400, headers);

  // RLS applies: contractors can only draft for leads they can see.
  const { data: lead, error: leadErr } = await client.from('leads').select('*').eq('id', body.lead_id).single();
  if (leadErr || !lead) return json({ error: 'Lead not found' }, 404, headers);
  const { data: template } = await client.from('email_templates').select('*').eq('id', body.template_id).single();
  if (!template) return json({ error: 'Template not found' }, 404, headers);
  const { data: notes } = await client
    .from('lead_notes').select('content').eq('lead_id', body.lead_id)
    .order('created_at', { ascending: false }).limit(3);
  const noteTexts = (notes ?? []).map((n) => (n as { content: string }).content);
  const { data: profile } = await client.from('profiles').select('full_name, email').eq('id', userData.user.id).single();
  const contractorName = (profile?.full_name ?? profile?.email ?? 'The Dreamlabs team').split(' ')[0]!;

  const vars = buildTemplateVars(lead as Record<string, unknown>, contractorName, noteTexts);
  const subject = substituteVariables(template.subject as string, vars);
  const bodyText = substituteVariables(template.body as string, vars);
  const missing = [...new Set([...subject.missing, ...bodyText.missing])];

  if (body.use_ai === false) {
    return json({ subject: subject.text, body: bodyText.text, ai_used: false, missing }, 200, headers);
  }
  try {
    const ai = await draftEmail({ subject: subject.text, body: bodyText.text, lead: lead as Record<string, unknown>, notes: noteTexts, contractorName });
    return json({ subject: ai.subject, body: ai.body, ai_used: true, missing }, 200, headers);
  } catch (e) {
    console.error('draftEmail failed, falling back to plain template:', e);
    return json({ subject: subject.text, body: bodyText.text, ai_used: false, missing }, 200, headers);
  }
});
```

- [ ] **Step 4: HUMAN STEP + deploy + smoke test**

**HUMAN STEP (Kevin):** create a free Gemini API key at https://aistudio.google.com/apikey and provide it. Then:

```bash
npx supabase secrets set GEMINI_API_KEY=<key>
npx supabase functions deploy generate-email
```

Smoke test (JWT as in Task 3; use the Apex Plumbing lead id `11a1923e-47e2-41cc-b4e3-f6a1e135c085` and the seeded Proposal Follow-Up template id from a DB query):
Expected: JSON with a personalised subject/body, `ai_used: true` (or `false` with the plain template if the key isn't set yet — report which).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai.ts supabase/functions/_shared/templateVars.ts supabase/functions/generate-email
git commit -m "feat: generate-email edge function - gemini 2.5 flash personalisation with plain fallback"
git push
```

---

### Task 9: `send-email` edge function

**Files:**
- Create: `supabase/functions/send-email/index.ts`

**Interfaces:**
- Consumes: `_shared/cors.ts`, `_shared/smtp.ts` (Task 3), `app_get_smtp_secret` (Task 2).
- Produces: POST (authed) `{ to_email: string, subject: string, body: string, lead_id?: string, log_id?: string }` → sends via the CALLER's stored SMTP creds. If `log_id` given, UPDATES that `email_logs` row (draft → sent/failed); else INSERTS a new row. Response `{ ok: true, log_id }` or `{ error, log_id? }`. Failed sends still write/update the log with `status='failed'`, `error_message`.

- [ ] **Step 1: Write `send-email/index.ts`**

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { sendMail } from '../_shared/smtp.ts';

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const authHeader = req.headers.get('Authorization') ?? '';
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await anonClient.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'Not signed in' }, 401, headers);

  const body = (await req.json()) as { to_email?: string; subject?: string; body?: string; lead_id?: string; log_id?: string };
  if (!body.to_email || !body.subject || !body.body) {
    return json({ error: 'to_email, subject and body are required' }, 400, headers);
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: settings } = await service
    .from('user_email_settings').select('*').eq('user_id', user.id).maybeSingle();
  if (!settings?.is_verified) return json({ error: 'Set up and verify your email in Settings → Email sending first' }, 400, headers);
  const { data: pass } = await service.rpc('app_get_smtp_secret', { uid: user.id });
  if (!pass) return json({ error: 'No stored email password — re-save your settings' }, 400, headers);

  // If updating an existing draft, make sure it belongs to the caller.
  if (body.log_id) {
    const { data: log } = await service.from('email_logs').select('sent_by').eq('id', body.log_id).single();
    if (!log || log.sent_by !== user.id) return json({ error: 'Draft not found' }, 404, headers);
  }

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

  const row = {
    lead_id: body.lead_id ?? null, sent_by: user.id, to_email: body.to_email,
    subject: body.subject, body: body.body, status, error_message: errorMessage,
    sent_at: new Date().toISOString(),
  };
  let logId = body.log_id ?? null;
  if (logId) {
    await service.from('email_logs').update(row).eq('id', logId);
  } else {
    const { data: inserted } = await service.from('email_logs').insert(row).select('id').single();
    logId = (inserted as { id: string } | null)?.id ?? null;
  }

  if (status === 'failed') return json({ error: 'Send failed: ' + errorMessage, log_id: logId }, 400, headers);
  return json({ ok: true, log_id: logId }, 200, headers);
});
```

- [ ] **Step 2: Deploy + smoke test**

```bash
npx supabase functions deploy send-email
```

Smoke test with Kevin's JWT: expect `{"error":"Set up and verify your email in Settings → Email sending first"}` until the Task 4 human step is done — that response itself proves auth + logic paths work. If Kevin HAS verified by now, send a real email to `kevindigitalinflux@gmail.com` and verify an `email_logs` row with `status='sent'` via the SQL runner.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-email
git commit -m "feat: send-email edge function - vault smtp send with status logging"
git push
```

---

### Task 10: Email composer modal + wire "Draft email" buttons

**Files:**
- Create: `src/components/emails/EmailComposer.tsx`
- Modify: `src/components/pipeline/LeadPanel.tsx` (enable "Draft email")
- Modify: `src/pages/LeadDetailPage.tsx` (add "Draft email" next to "Add note")

**Interfaces:**
- Consumes: `useTemplates` (Task 5); `generate-email` + `send-email` functions (Tasks 8–9); `EmailTemplate`, `Lead`; UI primitives.
- Produces: `EmailComposer({ lead: Lead, open: boolean, onClose(): void })` — self-contained modal: template select → Personalise (AI) with diff → editable subject/body → Send / Save draft.
- Diff view: line-level — lines only in the template render red/struck-through, lines only in the AI draft render green; unchanged lines dim. Implement with a small pure helper `diffLines(a: string, b: string): { kind: 'same' | 'removed' | 'added'; text: string }[]` in the same file using a simple LCS over lines (≤ 40 lines of code, no dependency).

- [ ] **Step 1: Write `src/components/emails/EmailComposer.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { Send, Sparkles, WandSparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTemplates } from '../../hooks/useTemplates';
import type { Lead } from '../../types';
import { Button } from '../ui/Button';
import { Input, SelectField, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';

interface DiffLine { kind: 'same' | 'removed' | 'added'; text: string }

/** Line-level LCS diff for the template → AI-draft comparison. */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ kind: 'same', text: A[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push({ kind: 'removed', text: A[i]! }); i++; }
    else { out.push({ kind: 'added', text: B[j]! }); j++; }
  }
  while (i < A.length) out.push({ kind: 'removed', text: A[i++]! });
  while (j < B.length) out.push({ kind: 'added', text: B[j++]! });
  return out;
}

interface EmailComposerProps {
  lead: Lead;
  open: boolean;
  onClose: () => void;
  /** When reviewing an existing draft from the queue. */
  draft?: { log_id: string; subject: string; body: string } | null;
}

/** Draft-email modal: template → optional AI personalisation with diff → edit → send. */
export function EmailComposer({ lead, open, onClose, draft = null }: EmailComposerProps) {
  const { templates } = useTemplates();
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [baseBody, setBaseBody] = useState<string | null>(null); // pre-AI body for the diff
  const [showDiff, setShowDiff] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState<'load' | 'ai' | 'send' | 'save' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const diff = useMemo(() => (baseBody !== null && showDiff ? diffLines(baseBody, body) : null), [baseBody, body, showDiff]);

  async function generate(useAi: boolean) {
    if (!templateId) return setMsg({ kind: 'err', text: 'Pick a template first.' });
    setBusy(useAi ? 'ai' : 'load'); setMsg(null);
    const { data, error } = await supabase.functions.invoke('generate-email', {
      body: { lead_id: lead.id, template_id: templateId, use_ai: useAi },
    });
    setBusy(null);
    if (error) return setMsg({ kind: 'err', text: error.message });
    const r = data as { subject: string; body: string; ai_used: boolean; missing: string[]; error?: string };
    if (r.error) return setMsg({ kind: 'err', text: r.error });
    if (useAi && !r.ai_used) setMsg({ kind: 'err', text: 'AI unavailable — using the plain template instead.' });
    if (useAi) { setBaseBody(body || null); setShowDiff(true); } else { setBaseBody(r.body); setShowDiff(false); }
    setSubject(r.subject); setBody(r.body); setMissing(r.missing);
  }

  async function send(asDraft: boolean) {
    if (!lead.email) return setMsg({ kind: 'err', text: 'This lead has no email address — add one first.' });
    if (!subject.trim() || !body.trim()) return setMsg({ kind: 'err', text: 'Subject and body are required.' });
    setBusy(asDraft ? 'save' : 'send'); setMsg(null);
    if (asDraft) {
      const { error } = await supabase.from('email_logs').insert({
        lead_id: lead.id, to_email: lead.email, subject, body, status: 'draft',
        sent_by: (await supabase.auth.getUser()).data.user?.id,
      });
      setBusy(null);
      if (error) return setMsg({ kind: 'err', text: error.message });
      setMsg({ kind: 'ok', text: 'Saved to your review queue.' });
      return;
    }
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to_email: lead.email, subject, body, lead_id: lead.id, log_id: draft?.log_id },
    });
    setBusy(null);
    if (error) return setMsg({ kind: 'err', text: error.message });
    const r = data as { ok?: boolean; error?: string };
    if (r.error) return setMsg({ kind: 'err', text: r.error });
    setMsg({ kind: 'ok', text: 'Sent ✓' });
    setTimeout(onClose, 800);
  }

  return (
    <Modal open={open} onClose={onClose} title={`Email — ${lead.business_name}`}>
      <div className="flex flex-col gap-4">
        {!lead.email && <p role="alert" className="text-sm text-red-400">This lead has no email address.</p>}
        <SelectField label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Choose…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectField>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void generate(false)} disabled={busy !== null}>{busy === 'load' ? 'Loading…' : 'Use template'}</Button>
          <Button onClick={() => void generate(true)} disabled={busy !== null}>
            <Sparkles className="h-4 w-4" aria-hidden />{busy === 'ai' ? 'Personalising…' : 'Personalise with AI'}
          </Button>
        </div>
        {missing.length > 0 && (
          <p className="text-xs text-amber-400">No value for: {missing.map((m) => `{{${m}}}`).join(', ')} — those spots are blank, check the draft reads well.</p>
        )}
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        {diff && (
          <div className="max-h-48 overflow-y-auto rounded-lg bg-surface/60 p-3 text-xs">
            <p className="mb-1 flex items-center gap-1 font-bold uppercase tracking-wide text-muted"><WandSparkles className="h-3.5 w-3.5" aria-hidden />Template → AI changes</p>
            {diff.map((l, i) => (
              <p key={i} className={`whitespace-pre-wrap ${l.kind === 'added' ? 'text-emerald-400' : l.kind === 'removed' ? 'text-red-400/70 line-through' : 'text-muted/60'}`}>{l.text || ' '}</p>
            ))}
            <button type="button" onClick={() => setShowDiff(false)} className="mt-2 cursor-pointer text-cyan">Hide diff</button>
          </div>
        )}
        <Textarea label="Body (plain text — lands in inboxes better)" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        {msg && <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => void send(true)} disabled={busy !== null}>{busy === 'save' ? 'Saving…' : 'Save as draft'}</Button>
          <Button onClick={() => void send(false)} disabled={busy !== null || !lead.email}>
            <Send className="h-4 w-4" aria-hidden />{busy === 'send' ? 'Sending…' : `Send to ${lead.email ?? '—'}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Enable the "Draft email" buttons**

`src/components/pipeline/LeadPanel.tsx`: add `const [emailOpen, setEmailOpen] = useState(false);` and `import { EmailComposer } from '../emails/EmailComposer';`. Replace the disabled button `<Button variant="secondary" className="flex-1" disabled title="Email automation arrives in cycle 2">Draft email</Button>` with `<Button variant="secondary" className="flex-1" onClick={() => setEmailOpen(true)}>Draft email</Button>`, and next to the existing `<NoteComposer …/>` add `{lead && <EmailComposer lead={lead} open={emailOpen} onClose={() => setEmailOpen(false)} />}`.

`src/pages/LeadDetailPage.tsx`: add the same state + import; in the header (after the deal-value span) add `<Button variant="secondary" onClick={() => setEmailOpen(true)}>Draft email</Button>` and render `<EmailComposer lead={lead} open={emailOpen} onClose={() => setEmailOpen(false)} />` beside the existing `<NoteComposer …/>`.

- [ ] **Step 3: Add diff tests**

Append to a new file `src/components/emails/EmailComposer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { diffLines } from './EmailComposer';

describe('diffLines', () => {
  it('marks unchanged lines same', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { kind: 'same', text: 'a' }, { kind: 'same', text: 'b' },
    ]);
  });
  it('marks additions and removals', () => {
    const d = diffLines('keep\nold line', 'keep\nnew line');
    expect(d).toEqual([
      { kind: 'same', text: 'keep' },
      { kind: 'removed', text: 'old line' },
      { kind: 'added', text: 'new line' },
    ]);
  });
});
```

Run `npx vitest run` — green. (If importing a .tsx file into a .ts test trips vitest, name the test file `.test.tsx` instead.)

- [ ] **Step 4: Verify in browser + commit**

1. Lead panel → "Draft email" opens the composer; pick "Proposal Follow-Up" → "Use template" fills subject/body with variables substituted and amber warnings for empty vars.
2. "Personalise with AI" → body updates and the colour diff shows AI changes (or the fallback banner if GEMINI_API_KEY pending).
3. "Save as draft" → row appears in `email_logs` with `status='draft'` (verify via SQL runner).
4. **If Kevin's SMTP is verified**: Send to a lead whose email is `kevindigitalinflux+lead@gmail.com` (set the Apex Plumbing lead's email to that first via the UI) → real email arrives, log row `status='sent'`.
5. `npx tsc --noEmit && npx vitest run` pass.

```bash
git add src/components/emails/EmailComposer.tsx src/components/emails/EmailComposer.test.ts src/components/pipeline/LeadPanel.tsx src/pages/LeadDetailPage.tsx
git commit -m "feat: email composer - template load, AI personalisation diff, send + save draft"
git push
```

---

### Task 11: Logs tab + CSV export (TDD for CSV)

**Files:**
- Create: `src/lib/csv.ts`
- Test: `src/lib/csv.test.ts`
- Create: `src/hooks/useEmailLogs.ts`
- Create: `src/components/emails/EmailLogList.tsx`
- Modify: `src/pages/EmailsHub.tsx` (replace Logs ComingSoon)

**Interfaces:**
- Consumes: `EmailLog` (Task 1); `useProfiles` (existing); `useAuth`; `formatShortDate` (existing utils).
- Produces:
  - `toCsv(headers: string[], rows: string[][]): string` — RFC-4180 quoting (quote when a cell contains `"`, `,` or newline; double embedded quotes), `\r\n` line endings.
  - `useEmailLogs(): { logs: EmailLog[]; loading; error; refresh() }` — selects `email_logs` ordered `sent_at desc` (RLS scopes rows; admin sees all).
  - `EmailLogList` — table (Date, Company, Subject, Sent by, Status), row click expands the body inline, filters: lead search text, contractor select (admin only), from/to date inputs; "Export CSV" downloads `email-logs.csv` via a Blob link.

- [ ] **Step 1: Write the failing CSV tests**

`src/lib/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('joins headers and rows with CRLF', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toBe('a,b\r\n1,2');
  });
  it('quotes cells containing commas, quotes or newlines', () => {
    expect(toCsv(['x'], [['hello, world']])).toBe('x\r\n"hello, world"');
    expect(toCsv(['x'], [['say "hi"']])).toBe('x\r\n"say ""hi"""');
    expect(toCsv(['x'], [['line1\nline2']])).toBe('x\r\n"line1\nline2"');
  });
});
```

- [ ] **Step 2: Run to verify failure, then write `src/lib/csv.ts`**

```ts
function cell(value: string): string {
  return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

/** RFC-4180 CSV: quoted cells where needed, CRLF rows. */
export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
```

Run `npx vitest run` — green.

- [ ] **Step 3: Write `src/hooks/useEmailLogs.ts`** (same refresh pattern as `useTemplates`, table `email_logs`, `order('sent_at', { ascending: false })`, no save/remove).

- [ ] **Step 4: Write `src/components/emails/EmailLogList.tsx`**

Follow `ListTable`'s table markup conventions (sticky header, `border-line`, row hover). Columns: Date (`formatShortDate(log.sent_at)`), Company (resolve via a `leads` select of id+business_name fetched once in the component — `supabase.from('leads').select('id, business_name')`; RLS scopes it), Subject (truncate), Sent by (initials via `useProfiles`), Status (`draft` = muted chip, `sent` = emerald chip, `failed` = red chip with `error_message` in a `title` attr). Row click toggles an expanded `<tr>` with the full `whitespace-pre-wrap` body. Filters row above the table: `<input type="search">` on company/subject, admin-only contractor `SelectField`, two `<input type="date">` bounds — all client-side filtering with `useMemo`. Export button:

```tsx
function exportCsv(rows: EmailLog[], companyOf: (id: string | null) => string) {
  const csv = toCsv(
    ['Date', 'Company', 'To', 'Subject', 'Status', 'Sent by'],
    rows.map((l) => [l.sent_at, companyOf(l.lead_id), l.to_email, l.subject, l.status, l.sent_by ?? '']),
  );
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'email-logs.csv'; a.click();
  URL.revokeObjectURL(url);
}
```

Empty state: `EmptyState icon={Mail} title="No emails yet" hint="Emails you send appear here."`. Loading: `Skeleton h-40`. Error: `role="alert"` red text.

- [ ] **Step 5: Replace the Logs ComingSoon in `EmailsHub.tsx`** with `<EmailLogList />`.

- [ ] **Step 6: Verify in browser + commit**

1. Logs tab lists the rows created in Task 10 (draft + sent/failed), status chips coloured, row expands to full body.
2. Search narrows; date bounds work; Export downloads a CSV that opens correctly (spot-check quoting on a subject containing a comma).
3. `npx tsc --noEmit && npx vitest run` pass.

```bash
git add src/lib/csv.ts src/lib/csv.test.ts src/hooks/useEmailLogs.ts src/components/emails/EmailLogList.tsx src/pages/EmailsHub.tsx
git commit -m "feat: email log tab - filters, inline body expand, csv export"
git push
```

---

### Task 12: Sequence enrollment UI

**Files:**
- Create: `src/hooks/useEnrollments.ts`
- Create: `src/components/emails/EnrollmentControl.tsx`
- Modify: `src/components/pipeline/LeadPanel.tsx` (enable "Enroll in sequence")
- Modify: `src/pages/LeadDetailPage.tsx` (Sequences card shows the control)

**Interfaces:**
- Consumes: `SequenceEnrollment`, `EmailSequence` (Task 1); `useSequences` (Task 7); `nextSendAtFor` (Task 6).
- Produces:
  - `useEnrollments(leadId: string): { enrollment: (SequenceEnrollment & { sequence: EmailSequence }) | null; loading; enroll(sequenceId: string): Promise<string | null>; setStatus(status: 'active' | 'paused' | 'cancelled'): Promise<string | null> }` — at most one non-terminal enrollment per lead is assumed; `enroll` inserts `{ lead_id, sequence_id, current_step: 1, next_send_at: nextSendAtFor(new Date(), steps, 1), status: 'active', enrolled_by: user }`; select joins `email_sequences` via `.select('*, sequence:email_sequences(*)')`.
  - `EnrollmentControl({ lead: Lead })` — when no enrollment: sequence `SelectField` + "Enroll" button; when enrolled: sequence name, "Step x of y", next due date (`formatShortDate`), status chip, Pause/Resume and Cancel buttons.

- [ ] **Step 1: Write `src/hooks/useEnrollments.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { nextSendAtFor } from '../lib/sequenceMath';
import type { EmailSequence, SequenceEnrollment } from '../types';

type EnrollmentWithSequence = SequenceEnrollment & { sequence: EmailSequence };

/** The lead's current (non-cancelled/completed) enrollment, if any. */
export function useEnrollments(leadId: string) {
  const { session } = useAuth();
  const [enrollment, setEnrollment] = useState<EnrollmentWithSequence | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('sequence_enrollments')
      .select('*, sequence:email_sequences(*)')
      .eq('lead_id', leadId)
      .in('status', ['active', 'paused'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setEnrollment(data as EnrollmentWithSequence | null);
    setLoading(false);
  }, [leadId]);

  useEffect(() => { setLoading(true); void refresh(); }, [refresh]);

  const enroll = useCallback(async (sequenceId: string): Promise<string | null> => {
    const { data: seq } = await supabase.from('email_sequences').select('*').eq('id', sequenceId).single();
    if (!seq) return 'Sequence not found';
    const { error } = await supabase.from('sequence_enrollments').insert({
      lead_id: leadId, sequence_id: sequenceId, current_step: 1,
      next_send_at: nextSendAtFor(new Date(), (seq as EmailSequence).steps, 1),
      status: 'active', enrolled_by: session?.user.id,
    });
    if (error) return error.message;
    await refresh();
    return null;
  }, [leadId, session, refresh]);

  const setStatus = useCallback(async (status: 'active' | 'paused' | 'cancelled'): Promise<string | null> => {
    if (!enrollment) return 'No enrollment';
    const { error } = await supabase.from('sequence_enrollments').update({ status }).eq('id', enrollment.id);
    if (error) return error.message;
    await refresh();
    return null;
  }, [enrollment, refresh]);

  return { enrollment, loading, enroll, setStatus };
}
```

- [ ] **Step 2: Write `src/components/emails/EnrollmentControl.tsx`**

```tsx
import { useState } from 'react';
import { Pause, Play, Repeat, XCircle } from 'lucide-react';
import { useEnrollments } from '../../hooks/useEnrollments';
import { useSequences } from '../../hooks/useSequences';
import { formatShortDate } from '../../lib/utils';
import type { Lead } from '../../types';
import { Button } from '../ui/Button';
import { SelectField } from '../ui/Input';
import { Skeleton } from '../ui/Skeleton';

/** Enroll a lead in a sequence, or manage the active enrollment (SPEC §7). */
export function EnrollmentControl({ lead }: { lead: Lead }) {
  const { enrollment, loading, enroll, setStatus } = useEnrollments(lead.id);
  const { sequences } = useSequences();
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true); setError(null);
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
  }

  if (loading) return <Skeleton className="h-16 w-full" />;

  if (!enrollment) {
    return (
      <div className="flex flex-col gap-2">
        {!lead.email && <p className="text-xs text-amber-400">Add an email address to this lead first — sequences draft emails.</p>}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <SelectField label="Enroll in sequence" value={picked} onChange={(e) => setPicked(e.target.value)}>
              <option value="">Choose…</option>
              {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
          </div>
          <Button onClick={() => picked && void run(() => enroll(picked))} disabled={busy || !picked || !lead.email}>
            <Repeat className="h-4 w-4" aria-hidden />Enroll
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  const total = enrollment.sequence.steps.length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        <span className="font-semibold">{enrollment.sequence.name}</span>
        <span className="text-muted"> — step {enrollment.current_step} of {total}</span>
      </p>
      <p className="text-xs text-muted">
        {enrollment.status === 'paused' ? 'Paused' : enrollment.next_send_at ? `Next draft ${formatShortDate(enrollment.next_send_at)}` : 'Finishing'}
        {' · drafts land in your review queue — nothing sends itself'}
      </p>
      <div className="flex gap-2">
        {enrollment.status === 'active'
          ? <Button variant="secondary" onClick={() => void run(() => setStatus('paused'))} disabled={busy}><Pause className="h-4 w-4" aria-hidden />Pause</Button>
          : <Button variant="secondary" onClick={() => void run(() => setStatus('active'))} disabled={busy}><Play className="h-4 w-4" aria-hidden />Resume</Button>}
        <Button variant="ghost" onClick={() => void run(() => setStatus('cancelled'))} disabled={busy}><XCircle className="h-4 w-4" aria-hidden />Cancel</Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Wire it in**

`LeadPanel.tsx`: replace the disabled "Enroll in sequence" button with a new `<Section title="Sequence"><EnrollmentControl lead={lead} /></Section>` placed after the "Next action" section (remove the old disabled button; keep "Draft email").
`LeadDetailPage.tsx`: inside the existing "Sequences" card, replace `<SequencesSection leadId={lead.id} />` with `<EnrollmentControl lead={lead} />` (delete the now-unused `SequencesSection` import; the component itself may stay in `LeadDetailSections.tsx`).

- [ ] **Step 4: Verify in browser + commit**

1. Lead panel → Sequence section: pick "Proposal Follow-Up" → Enroll → shows "step 1 of 3", next draft today, review-queue reassurance line.
2. Pause → shows Paused; Resume; Cancel → back to the enroll picker.
3. DB check via SQL runner: enrollment row `status`, `next_send_at` correct (step 1 delay 0 → today).
4. `npx tsc --noEmit && npx vitest run` pass.

```bash
git add src/hooks/useEnrollments.ts src/components/emails/EnrollmentControl.tsx src/components/pipeline/LeadPanel.tsx src/pages/LeadDetailPage.tsx
git commit -m "feat: sequence enrollment - enroll, progress, pause/resume/cancel"
git push
```

---

### Task 13: `check-sequences` cron function + live review queue

**Files:**
- Create: `supabase/functions/check-sequences/index.ts`
- Create: `src/hooks/useDrafts.ts`
- Modify: `src/components/dashboard/EmailReviewQueue.tsx` (replace placeholder)
- Modify: `src/pages/Dashboard.tsx` (pass new props)

**Interfaces:**
- Consumes: `_shared/ai.ts`, `_shared/templateVars.ts`, `_shared/cors.ts`; `advanceEnrollment` logic (re-implement the same 12 lines in Deno — copy from `src/lib/sequenceMath.ts` into the function file with a `// keep in sync` comment); `CRON_SECRET` env (Task 2).
- Produces:
  - `check-sequences` (POST): requires header `x-cron-secret: <CRON_SECRET>`; drafts due enrollments; response `{ processed: n, drafted: n, skipped: [{ id, reason }] }`.
  - `useDrafts(): { drafts: (EmailLog & { lead: { id: string; business_name: string } | null })[]; loading; refresh() }` — own `email_logs` where `status='draft'`, joined lead, newest first.
  - `EmailReviewQueue({ drafts, loading, onReview(draft): void })` — compact list per SPEC §8: company, subject, source chip ("Sequence" when `sequence_enrollment_id` else "Manual"), "Review & send" button → Dashboard opens `EmailComposer` with `draft={{ log_id, subject, body }}` for that lead; Discard button deletes the log row.

- [ ] **Step 1: Write `check-sequences/index.ts`**

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';
import { draftEmail } from '../_shared/ai.ts';
import { buildTemplateVars, substituteVariables } from '../_shared/templateVars.ts';

interface Step { delay_days: number; template_type: string; subject_override: string | null }

// Deno copy of advanceEnrollment from src/lib/sequenceMath.ts — keep in sync.
function advance(currentStep: number, steps: Step[], now: Date) {
  const next = currentStep + 1;
  if (next > steps.length) return { current_step: currentStep, next_send_at: null, status: 'completed' };
  return { current_step: next, next_send_at: new Date(now.getTime() + steps[next - 1]!.delay_days * 86_400_000).toISOString(), status: 'active' };
}

const HEADERS = { 'Content-Type': 'application/json' };

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

  let drafted = 0;
  const skipped: { id: string; reason: string }[] = [];

  for (const row of due ?? []) {
    const enrollment = row as Record<string, unknown> & {
      id: string; current_step: number; enrolled_by: string | null;
      sequence: { steps: Step[] } | null; lead: Record<string, unknown> | null;
    };
    const steps = enrollment.sequence?.steps ?? [];
    const step = steps[enrollment.current_step - 1];
    const lead = enrollment.lead;
    if (!step || !lead) { skipped.push({ id: enrollment.id, reason: 'missing step or lead' }); continue; }
    if (!lead.email) { skipped.push({ id: enrollment.id, reason: 'lead has no email' }); continue; }

    const { data: template } = await service
      .from('email_templates').select('*')
      .eq('template_type', step.template_type).eq('is_default', true)
      .limit(1).maybeSingle();
    if (!template) { skipped.push({ id: enrollment.id, reason: `no default template ${step.template_type}` }); continue; }

    const { data: enroller } = await service
      .from('profiles').select('full_name, email').eq('id', enrollment.enrolled_by ?? '').maybeSingle();
    const contractorName = (enroller?.full_name ?? enroller?.email ?? 'The Dreamlabs team').split(' ')[0]!;
    const { data: notes } = await service
      .from('lead_notes').select('content').eq('lead_id', lead.id as string)
      .order('created_at', { ascending: false }).limit(3);
    const noteTexts = (notes ?? []).map((n) => (n as { content: string }).content);

    const vars = buildTemplateVars(lead, contractorName, noteTexts);
    const subject = substituteVariables((step.subject_override ?? template.subject) as string, vars);
    const bodyText = substituteVariables(template.body as string, vars);

    let finalSubject = subject.text;
    let finalBody = bodyText.text;
    try {
      const ai = await draftEmail({ subject: subject.text, body: bodyText.text, lead, notes: noteTexts, contractorName });
      finalSubject = ai.subject; finalBody = ai.body;
    } catch (e) {
      console.error(`AI draft failed for enrollment ${enrollment.id}, using plain template:`, e);
    }

    await service.from('email_logs').insert({
      lead_id: lead.id, sequence_enrollment_id: enrollment.id, sent_by: enrollment.enrolled_by,
      to_email: lead.email, subject: finalSubject, body: finalBody, status: 'draft',
    });
    await service.from('sequence_enrollments')
      .update(advance(enrollment.current_step, steps, new Date()))
      .eq('id', enrollment.id);
    drafted++;
    await new Promise((r) => setTimeout(r, 7000)); // stay under Gemini free-tier 10 RPM
  }

  return json({ processed: (due ?? []).length, drafted, skipped }, 200, HEADERS);
});
```

- [ ] **Step 2: Deploy and prove the loop end-to-end (minute-level test)**

```bash
npx supabase functions deploy check-sequences
```

1. Enroll the Apex Plumbing lead in "Proposal Follow-Up" (Task 12 UI) — its step 1 has delay 0 so `next_send_at` = now.
2. Invoke manually: `curl -s -X POST "https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/check-sequences" -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" -d '{}'` (CRON_SECRET from `.env`).
   Expected: `{"processed":1,"drafted":1,"skipped":[]}`.
3. SQL check: a new `email_logs` row `status='draft'` with `sequence_enrollment_id` set; the enrollment is now `current_step=2`, `next_send_at` two days out.
4. Re-invoke immediately → `{"processed":0,...}` (idempotent — nothing due).
5. Wrong secret → 403.

- [ ] **Step 3: Write `src/hooks/useDrafts.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { EmailLog } from '../types';

export type DraftLog = EmailLog & { lead: { id: string; business_name: string } | null };

/** The caller's draft emails awaiting review (RLS scopes to own; admin sees all). */
export function useDrafts() {
  const [drafts, setDrafts] = useState<DraftLog[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('email_logs')
      .select('*, lead:leads(id, business_name)')
      .eq('status', 'draft')
      .order('sent_at', { ascending: false });
    setDrafts((data as DraftLog[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { drafts, loading, refresh };
}
```

- [ ] **Step 4: Replace `EmailReviewQueue.tsx`**

```tsx
import { MailCheck, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { DraftLog } from '../../hooks/useDrafts';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';

interface EmailReviewQueueProps {
  drafts: DraftLog[];
  loading: boolean;
  onReview: (draft: DraftLog) => void;
  onChanged: () => void;
}

/** Drafts awaiting review — sequence output + manual saves. Nothing sends without a click. */
export function EmailReviewQueue({ drafts, loading, onReview, onChanged }: EmailReviewQueueProps) {
  if (loading) return <Skeleton className="h-20 w-full" />;
  if (drafts.length === 0) {
    return <EmptyState icon={MailCheck} title="No emails waiting for review" hint="Sequence drafts and saved drafts appear here for you to approve." />;
  }
  async function discard(id: string) {
    await supabase.from('email_logs').delete().eq('id', id);
    onChanged();
  }
  return (
    <ul className="flex flex-col gap-2">
      {drafts.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
          <span className="font-heading text-sm font-bold">{d.lead?.business_name ?? d.to_email}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${d.sequence_enrollment_id ? 'bg-violet/25 text-offwhite' : 'bg-surface text-muted'}`}>
            {d.sequence_enrollment_id ? 'Sequence' : 'Manual'}
          </span>
          <span className="w-full truncate text-sm text-muted sm:w-auto sm:flex-1">{d.subject}</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => void discard(d.id)} aria-label="Discard draft" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-red-400"><Trash2 className="h-4 w-4" aria-hidden /></button>
            <Button variant="secondary" onClick={() => onReview(d)}>Review &amp; send</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Wire the Dashboard**

In `src/pages/Dashboard.tsx`: add `const { drafts, loading: draftsLoading, refresh: refreshDrafts } = useDrafts();` and `const [reviewing, setReviewing] = useState<DraftLog | null>(null);`. Replace `<EmailReviewQueue draftCount={draftCount} />` with `<EmailReviewQueue drafts={drafts} loading={draftsLoading} onReview={setReviewing} onChanged={() => void refreshDrafts()} />`. Render, near `LeadPanel`:

```tsx
{reviewing && reviewing.lead && (
  <EmailComposer
    lead={leads.find((l) => l.id === reviewing.lead!.id) ?? null!}
    open
    onClose={() => { setReviewing(null); void refreshDrafts(); }}
    draft={{ log_id: reviewing.id, subject: reviewing.subject, body: reviewing.body }}
  />
)}
```

Guard: only render when the lead is found in `leads` (skip `?? null!` — use a proper `const reviewLead = …; reviewing && reviewLead && (…)`). Also update the StatsBar "Emails to review" number to `drafts.length` and drop `draftCount` from `useDashboardStats` usage for that stat (keep `callsThisWeek`).

- [ ] **Step 6: Verify in browser + commit**

1. Dashboard shows the Task-13 sequence draft in the queue with a "Sequence" chip; "Emails to review" stat matches.
2. Review & send opens the composer pre-filled; Send (if SMTP verified) → draft leaves the queue, log flips to `sent`; otherwise Discard removes it.
3. `npx tsc --noEmit && npx vitest run` pass.

```bash
git add supabase/functions/check-sequences src/hooks/useDrafts.ts src/components/dashboard/EmailReviewQueue.tsx src/pages/Dashboard.tsx
git commit -m "feat: check-sequences cron drafting + live review queue on dashboard"
git push
```

---

### Task 14: `parse-notes` function + NoteComposer AI toggle

**Files:**
- Create: `supabase/functions/parse-notes/index.ts`
- Create: `src/components/pipeline/SuggestionDiff.tsx`
- Modify: `src/components/pipeline/NoteComposer.tsx` (enable the toggle)

**Interfaces:**
- Consumes: `parseNotes` from `_shared/ai.ts` (Task 8); `LeadSuggestion` type (Task 1); `LeadPatch` + existing `onUpdateLead` prop.
- Produces:
  - `parse-notes` (POST, authed): `{ lead_id: string, note: string }` → `{ suggestion: LeadSuggestion }` or `{ suggestion: null, error }` on AI failure (200 — the client treats null as "no suggestions"). Lead fetched with caller JWT (RLS).
  - `SuggestionDiff({ lead, suggestion, onApply(patch), onDismiss })` — table of field / current → suggested rows (stage labels via `stageInfo`, currency via `formatCurrency`, package via `packageLabel`), rationale line, Apply all / Dismiss. `pain_point` is display-only (no lead column — shown so the user can mention it in emails).

- [ ] **Step 1: Write `parse-notes/index.ts`**

Follow `generate-email/index.ts` exactly for CORS/auth/lead fetch (caller JWT). Then:

```ts
  const { data: lead, error: leadErr } = await client.from('leads').select('*').eq('id', body.lead_id).single();
  if (leadErr || !lead) return json({ error: 'Lead not found' }, 404, headers);
  try {
    const suggestion = await parseNotes({ note: String(body.note ?? ''), lead: lead as Record<string, unknown> });
    return json({ suggestion }, 200, headers);
  } catch (e) {
    console.error('parse-notes failed:', e);
    return json({ suggestion: null, error: 'AI unavailable' }, 200, headers);
  }
```

Deploy: `npx supabase functions deploy parse-notes`. Smoke test with Kevin's JWT + Apex lead + note text "They want to go ahead with the AI Foundation package at £3,000, call them Friday to confirm" → suggestion containing `package_tier: 'ai_foundation'`, `deal_value: 3000`, a `next_action_date`, and a rationale.

- [ ] **Step 2: Write `src/components/pipeline/SuggestionDiff.tsx`**

```tsx
import { ArrowRight, Sparkles } from 'lucide-react';
import { formatCurrency, packageLabel, stageInfo } from '../../lib/utils';
import type { LeadPatch } from '../../lib/leadUpdates';
import type { Lead, LeadSuggestion } from '../../types';
import { Button } from '../ui/Button';

interface SuggestionDiffProps {
  lead: Lead;
  suggestion: LeadSuggestion;
  onApply: (patch: LeadPatch) => void;
  onDismiss: () => void;
}

/** Current → suggested field diff for parse-notes output. Nothing applies without the click. */
export function SuggestionDiff({ lead, suggestion, onApply, onDismiss }: SuggestionDiffProps) {
  const rows: { label: string; from: string; to: string }[] = [];
  if (suggestion.stage && suggestion.stage !== lead.stage) rows.push({ label: 'Stage', from: stageInfo(lead.stage).label, to: stageInfo(suggestion.stage).label });
  if (suggestion.deal_value !== undefined && suggestion.deal_value !== lead.deal_value) rows.push({ label: 'Deal value', from: lead.deal_value !== null ? formatCurrency(lead.deal_value) : '—', to: formatCurrency(suggestion.deal_value) });
  if (suggestion.package_tier && suggestion.package_tier !== lead.package_tier) rows.push({ label: 'Package', from: packageLabel(lead.package_tier), to: packageLabel(suggestion.package_tier) });
  if (suggestion.next_action_date && suggestion.next_action_date !== lead.next_action_date) rows.push({ label: 'Next action date', from: lead.next_action_date ?? '—', to: suggestion.next_action_date });
  if (suggestion.next_action_note && suggestion.next_action_note !== lead.next_action_note) rows.push({ label: 'Next action', from: lead.next_action_note ?? '—', to: suggestion.next_action_note });
  if (suggestion.pain_point) rows.push({ label: 'Pain point (info only)', from: '—', to: suggestion.pain_point });

  function apply() {
    const patch: LeadPatch = {};
    if (suggestion.stage) patch.stage = suggestion.stage;
    if (suggestion.deal_value !== undefined) patch.deal_value = suggestion.deal_value;
    if (suggestion.package_tier) patch.package_tier = suggestion.package_tier;
    if (suggestion.next_action_date) patch.next_action_date = suggestion.next_action_date;
    if (suggestion.next_action_note) patch.next_action_note = suggestion.next_action_note;
    onApply(patch);
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">AI found nothing to update from this note.</p>
        <Button variant="ghost" onClick={onDismiss}>Close</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-cyan" aria-hidden />Suggested updates from your note</p>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.label} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface/60 p-2 text-sm">
            <span className="w-36 text-xs font-semibold text-muted">{r.label}</span>
            <span className="text-muted line-through">{r.from}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted" aria-hidden />
            <span className="font-semibold text-emerald-400">{r.to}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{suggestion.rationale}</p>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onDismiss}>Dismiss</Button>
        <Button onClick={apply}>Apply updates</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Enable the toggle in `NoteComposer.tsx`**

Add state `const [aiParse, setAiParse] = useState(true);`, `const [suggestion, setSuggestion] = useState<LeadSuggestion | null>(null);` and a third phase `'suggest'` in the `Phase` union. Replace the disabled checkbox label with:

```tsx
<label className="flex items-center gap-2 text-sm">
  <input type="checkbox" checked={aiParse} onChange={(e) => setAiParse(e.target.checked)} className="h-4 w-4 accent-violet-500" />
  Let AI suggest lead updates from this note
</label>
```

After a successful save (both `saveDebrief` — after its next-action update — and `saveNextAction` at the end of the free-text flow), when `aiParse` is on: call `supabase.functions.invoke('parse-notes', { body: { lead_id: lead.id, note } })` with the compiled/free text, and if `data.suggestion` is non-null set `setSuggestion(data.suggestion); setPhase('suggest');` instead of `reset()`. Render phase `'suggest'` inside the Modal as `<SuggestionDiff lead={lead} suggestion={suggestion} onApply={(patch) => { void onUpdateLead(patch).then(() => reset()); }} onDismiss={reset} />` with the Modal title "AI suggestions". On AI failure/null suggestion just `reset()` (never block the note flow).

- [ ] **Step 4: Verify in browser + commit**

1. Log a free-text note on Apex: "Owner agreed to the Automation Sprint at £4,500, send contract and call Tuesday" with the toggle ON → after the next-action phase, the suggestion diff shows package/deal/next-action rows with strikethrough → green values.
2. Apply → panel/detail reflect the changes; a stage change (if suggested) auto-logs to Activity via the existing path.
3. Toggle OFF → flow behaves exactly as before (no suggest phase).
4. `npx tsc --noEmit && npx vitest run` pass.

```bash
git add supabase/functions/parse-notes src/components/pipeline/SuggestionDiff.tsx src/components/pipeline/NoteComposer.tsx
git commit -m "feat: parse-notes AI suggestions with review diff in note composer"
git push
```

---

### Task 15: Cycle-2 verification, RLS audit, docs

**Files:**
- Modify: `CLAUDE.md` (Current Status)
- Modify: `docs/AUTOMATIONS.md` (move cycle-2 rows to Live)

- [ ] **Step 1: Full automated pass**

`npx vitest run && npx tsc --noEmit && npm run build` — all green (chunk-size warning acceptable).

- [ ] **Step 2: RLS + security audit (script)**

Extend the cycle-1 approach (throwaway contractor via service role, REST as both users — see scratchpad `rls-audit.mjs` pattern from the 2026-07-14 session, or rebuild it; keep it OUT of the repo). Checks:

1. Contractor sees default templates + own custom templates; cannot UPDATE a default template (0 rows / 403-style deny); CAN create + update own.
2. Contractor cannot read another user's `email_logs` rows or `user_email_settings` row (0 rows).
3. Contractor cannot read `vault.secrets` / call `app_get_smtp_secret` via REST rpc (permission denied).
4. `check-sequences` without the `x-cron-secret` header → 403.
5. `send-email` with a `log_id` belonging to another user → 404 "Draft not found".
6. Admin sees all `email_logs`.
Cleanup: delete throwaway user + any rows created.
Expected: every check PASS; paste the PASS/FAIL table into the task report.

- [ ] **Step 3: End-to-end sequence proof (already done in Task 13 step 2 — re-verify the full chain once more)**

Enrollment → manual cron invoke → draft in queue → Review & send (SMTP verified) → log `sent` → enrollment advanced. One paragraph of evidence in the report.

- [ ] **Step 4: Update docs**

`CLAUDE.md` Current Status: cycle 2 complete — add email module + parse-notes to Working; move email automation out of Not-yet-started; keep scraper/analytics/deploy there. Known issues: add "sequence templates limited to the 5 defaults (custom templates can't be sequence steps yet)".
`docs/AUTOMATIONS.md`: move the five cycle-2 rows into **Live** with any behaviour notes learned during the build.

- [ ] **Step 5: Commit + push**

```bash
git add CLAUDE.md docs/AUTOMATIONS.md
git commit -m "chore: cycle 2 complete - email automation + parse-notes live"
git push
```

---

## Self-Review Notes (applied)

- **Spec coverage:** Config (T3–4), templates (T2 seeds, T5 UI), composer + diff (T10), sequences (T2 seeds, T6 math, T7 builder, T12 enrollment, T13 cron+queue), logs+CSV (T11), send (T9), AI layer + swappable interface (T8), parse-notes (T14), RLS/testing/docs (T15). Human steps flagged: Gmail app password (T4), GEMINI_API_KEY (T8).
- **Consistency:** `draftEmail`/`parseNotes` defined once in `_shared/ai.ts`; `advanceEnrollment` exists in web (`sequenceMath.ts`) and one marked Deno copy; `EmailComposer` `draft` prop shape `{ log_id, subject, body }` used identically in T10 and T13; template steps reference `template_type` in both seeds (T2) and cron resolver (T13).
- **Known simplifications (deliberate):** sequences use default templates only; one active enrollment per lead; CSV export is client-side; no HTML email.

