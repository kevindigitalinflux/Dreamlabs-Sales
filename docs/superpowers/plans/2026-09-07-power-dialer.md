# Power Dialer (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every provider-agnostic piece of the power dialer feature — schema, per-contractor settings connection, and call-history display on a lead — so a contractor can connect their dialer account details today, and so nothing here needs rework once a specific provider (JustCall/Kixie/Aircall) is chosen.

**Architecture:** Mirrors this app's existing per-contractor SMTP pattern (`user_email_settings` / `email-settings` / `useEmailSettings` / `EmailConfig.tsx`) almost exactly: a new `user_dialer_settings` table holds provider + display fields, a new Vault RPC pair holds the real API key, and a new `dialer-settings` edge function exposes `get`/`save` actions (no `test` action yet — key validation is provider-specific and is out of scope until a provider is chosen). A new org-scoped `calls` table records call outcomes; a read-only `CallHistorySection` on the lead detail page displays them, following the exact pattern of the existing `EmailLogSection`. A `/dialer` route gets a real Sidebar nav entry rendering the app's existing `ComingSoon` component (the same convention already used for `/analytics`) — a real, discoverable placeholder rather than a page with fake/disabled functionality. The functional dialing screen itself is deferred until `dialer-push-queue` exists.

**Tech Stack:** React 18 + TypeScript, Supabase (Postgres + Vault + Edge Functions/Deno), Tailwind, existing `supabase-js` client.

**Spec:** `docs/superpowers/specs/2026-09-07-calling-integration-design.md` (§1 Schema, §2 `dialer-settings` bullet, §3 `/settings/dialer` and "Calls" section bullets — everything else in that spec, including `dialer-push-queue`/`dialer-webhook` and Phase 2, is explicitly out of scope here).

## Global Constraints

- No `any` — cast to `unknown` first if needed. Strict TypeScript throughout.
- Named exports only, no default exports.
- Tailwind utility classes only — no custom CSS or inline styles.
- Every component handles loading, error, and empty states.
- Keep components under ~150 lines.
- JSDoc-style one-line comments only where genuinely non-obvious (matches existing file style — most files here use a single doc comment per exported function/component, not full JSDoc blocks).
- The real dialer API key is Vault-stored via RPC, **never** a plain table column — same non-negotiable rule already applied to SMTP passwords and org API keys.
- `user_dialer_settings` is **per-contractor**, with no `org_id` column — matching `user_email_settings` exactly, per the spec's locked credential-model decision. `calls` **is** org-scoped, matching every other cycle-3+ table.
- Do not build `dialer-push-queue`, `dialer-webhook`, a "Power Dialer" page, or any `test`/live-validation action — all explicitly deferred until Kevin picks a provider.

---

### Task 1: Migration — `user_dialer_settings` + `calls` tables + Vault RPCs

**Files:**
- Create: `supabase/migrations/013_calling_integration.sql`

**Interfaces:**
- Produces: table `user_dialer_settings` (columns: `id`, `user_id`, `provider`, `phone_number`, `is_verified`, `created_at`, `updated_at`); table `calls` (columns: `id`, `lead_id`, `user_id`, `org_id`, `provider`, `external_call_id`, `direction`, `outcome`, `duration_seconds`, `recording_url`, `transcript`, `lead_note_id`, `created_at`); RPCs `app_set_dialer_secret(uid uuid, secret text)` and `app_get_dialer_secret(uid uuid)`, callable only by `service_role`.

- [ ] **Step 1: Write the migration file**

```sql
-- ─────────────────────────────────────────
-- CALLING INTEGRATION (PHASE 1: POWER DIALER) — schema only, provider-agnostic.
-- See docs/superpowers/specs/2026-09-07-calling-integration-design.md
-- ─────────────────────────────────────────

-- Per-contractor dialer connection. Mirrors user_email_settings exactly —
-- no org_id: calling is a personal resource, not a shared org one.
CREATE TABLE user_dialer_settings (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  provider      TEXT NOT NULL CHECK (provider IN ('justcall', 'kixie', 'aircall')),
  phone_number  TEXT,
  is_verified   BOOLEAN DEFAULT false,
  -- the real API key/secret is Vault-stored via app_set_dialer_secret/
  -- app_get_dialer_secret below — never a plain column.
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_dialer_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dialer_settings_own" ON user_dialer_settings
  USING (auth.uid() = user_id);

-- One row per completed call, regardless of provider. Org-scoped, matching
-- every other cycle-3+ table's established pattern.
CREATE TABLE calls (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id           UUID REFERENCES leads(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES profiles(id),
  org_id            UUID REFERENCES organizations(id),
  provider          TEXT NOT NULL,
  external_call_id  TEXT NOT NULL,
  direction         TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  outcome           TEXT CHECK (outcome IN ('answered', 'voicemail', 'no_answer', 'busy', 'failed')),
  duration_seconds  INTEGER,
  recording_url     TEXT,
  transcript        TEXT,
  lead_note_id      UUID REFERENCES lead_notes(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, external_call_id)
);
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calls_org_admin" ON calls FOR ALL USING (is_org_admin(org_id));
CREATE POLICY "calls_own_in_org" ON calls FOR ALL USING (
  is_org_member(org_id) AND (auth.uid() = user_id OR user_id IS NULL)
);

-- Vault helpers for per-user dialer API keys, mirroring app_set_smtp_secret
-- from 002_email_automation.sql exactly.
CREATE OR REPLACE FUNCTION app_set_dialer_secret(uid uuid, secret text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'dialer_key_' || uid::text;
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(secret, 'dialer_key_' || uid::text);
  ELSE
    PERFORM vault.update_secret(existing_id, secret);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_get_dialer_secret(uid uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dialer_key_' || uid::text;
$$;

REVOKE ALL ON FUNCTION app_set_dialer_secret(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_get_dialer_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_set_dialer_secret(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION app_get_dialer_secret(uuid) TO service_role;
```

Note: `lead_notes.note_type` already includes `'call'` in its original cycle-1 CHECK constraint — confirmed via the spec, no change needed here.

- [ ] **Step 2: Apply the migration to the Supabase project**

Use the `mcp__plugin_supabase_supabase__apply_migration` tool (name: `calling_integration`, matching this file's content), or `supabase db push` if working against a local/linked CLI project — whichever this repo's existing migrations were applied with. Confirm no error.

- [ ] **Step 3: Verify**

Query `information_schema.tables` (or `list_tables`) to confirm `user_dialer_settings` and `calls` both exist with RLS enabled, and confirm both RPCs exist via `information_schema.routines` filtering `routine_name IN ('app_set_dialer_secret', 'app_get_dialer_secret')`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/013_calling_integration.sql
git commit -m "feat: add power dialer schema (user_dialer_settings, calls, vault RPCs)"
```

---

### Task 2: Frontend types

**Files:**
- Modify: `src/types/index.ts` (append after the existing `UserEmailSettings` interface, which ends at line 148 as of this plan)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DialerProvider`, `UserDialerSettings`, `CallOutcome`, `Call` — used by Tasks 3, 4, 5.

- [ ] **Step 1: Add the types**

```typescript
export type DialerProvider = 'justcall' | 'kixie' | 'aircall';

export interface UserDialerSettings {
  id: string;
  user_id: string;
  provider: DialerProvider;
  phone_number: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export type CallOutcome = 'answered' | 'voicemail' | 'no_answer' | 'busy' | 'failed';

export interface Call {
  id: string;
  lead_id: string;
  user_id: string | null;
  org_id: string;
  provider: string;
  external_call_id: string;
  direction: 'outbound' | 'inbound';
  outcome: CallOutcome | null;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: string | null;
  lead_note_id: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add DialerProvider/UserDialerSettings/Call types"
```

---

### Task 3: `dialer-settings` edge function

**Files:**
- Create: `supabase/functions/dialer-settings/index.ts`

**Interfaces:**
- Consumes: `user_dialer_settings` table and `app_set_dialer_secret`/`app_get_dialer_secret` RPCs from Task 1; `corsHeaders`/`json` from `supabase/functions/_shared/cors.ts` (signatures: `corsHeaders(origin: string | null): Record<string, string>`, `json(body: unknown, status: number, headers: Record<string, string>): Response`).
- Produces: a deployed function accepting `{ action: 'get' }` → `{ settings: UserDialerSettings | null }`, and `{ action: 'save', provider, phone_number?, api_key? }` → `{ ok: true }` or `{ error: string }`. No `test` action in this task — deferred.

- [ ] **Step 1: Write the function**

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const VALID_PROVIDERS = ['justcall', 'kixie', 'aircall'];

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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers);
  }

  if (body.action === 'get') {
    const { data } = await service
      .from('user_dialer_settings').select('*').eq('user_id', user.id).maybeSingle();
    return json({ settings: data }, 200, headers);
  }

  if (body.action === 'save') {
    const provider = String(body.provider ?? '');
    if (!VALID_PROVIDERS.includes(provider)) {
      return json({ error: 'provider must be one of justcall, kixie, aircall' }, 400, headers);
    }
    const phoneNumber = body.phone_number ? String(body.phone_number) : null;
    const apiKey = body.api_key ? String(body.api_key) : null;

    const { error: upsertErr } = await service.from('user_dialer_settings').upsert(
      { user_id: user.id, provider, phone_number: phoneNumber, is_verified: false, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    if (upsertErr) return json({ error: upsertErr.message }, 400, headers);

    if (apiKey) {
      const { error: vaultErr } = await service.rpc('app_set_dialer_secret', { uid: user.id, secret: apiKey });
      if (vaultErr) return json({ error: 'Could not store API key: ' + vaultErr.message }, 500, headers);
    }
    return json({ ok: true }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
```

Note: `is_verified` is upserted to `false` on every save and never flipped to `true` anywhere in this task — there is deliberately no `test` action yet, so `is_verified` stays `false` until the provider-specific key-validation work lands in a later, separate task. This matches `email-settings`' own behavior before its `test` action existed.

- [ ] **Step 2: Deploy the function**

Use `mcp__plugin_supabase_supabase__deploy_edge_function` (name: `dialer-settings`), or the project's existing `supabase functions deploy` flow — whichever this repo's other functions were deployed with.

- [ ] **Step 3: Verify with a live call**

Using a real signed-in test user's access token (or the pattern already established in this project for testing edge functions with a throwaway auth user), call:

```bash
curl -X POST 'https://<project-ref>.supabase.co/functions/v1/dialer-settings' \
  -H "Authorization: Bearer <access_token>" -H "Content-Type: application/json" \
  -d '{"action":"get"}'
```

Expected: `{"settings":null}` for a user with no row yet. Then:

```bash
curl -X POST 'https://<project-ref>.supabase.co/functions/v1/dialer-settings' \
  -H "Authorization: Bearer <access_token>" -H "Content-Type: application/json" \
  -d '{"action":"save","provider":"justcall","phone_number":"+15551234567","api_key":"throwaway-test-key"}'
```

Expected: `{"ok":true}`. Re-run the `get` call and confirm `settings.provider === 'justcall'`, `settings.phone_number === '+15551234567'`, `settings.is_verified === false`. Clean up the throwaway row afterward (`delete from user_dialer_settings where user_id = '<test-user-id>'`) so it doesn't linger as fake data.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/dialer-settings/index.ts
git commit -m "feat: add dialer-settings edge function (get/save)"
```

---

### Task 4: `useDialerSettings` hook + `/settings/dialer` page

**Files:**
- Create: `src/hooks/useDialerSettings.ts`
- Create: `src/pages/DialerConfig.tsx`
- Modify: `src/pages/Settings.tsx` (add a link card, mirroring the existing `/settings/email` link)
- Modify: `src/App.tsx` (add the route)

**Interfaces:**
- Consumes: `DialerProvider`/`UserDialerSettings` types (Task 2); the deployed `dialer-settings` function (Task 3); UI primitives `Button`, `Card`, `Input`, `SelectField` from `src/components/ui/*` and `Skeleton` from `src/components/ui/Skeleton` (same imports `EmailConfig.tsx` already uses).
- Produces: route `/settings/dialer`; `useDialerSettings()` hook returning `{ settings, loading, error, save }` where `save(input: DialerSaveInput): Promise<string | null>`.

- [ ] **Step 1: Write the hook**

```typescript
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DialerProvider, UserDialerSettings } from '../types';

export interface DialerSaveInput {
  provider: DialerProvider;
  phone_number: string;
  api_key: string;
}

/** Per-contractor dialer connection via the dialer-settings edge function (API key never touches the client DB API). */
export function useDialerSettings() {
  const [settings, setSettings] = useState<UserDialerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase.functions.invoke('dialer-settings', { body: { action: 'get' } });
    if (err) setError(err.message);
    else {
      setSettings((data as { settings: UserDialerSettings | null }).settings);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (input: DialerSaveInput): Promise<string | null> => {
    const { data, error: err } = await supabase.functions.invoke('dialer-settings', {
      body: { action: 'save', ...input, api_key: input.api_key || undefined },
    });
    if (err) return err.message;
    const apiErr = (data as { error?: string }).error;
    if (apiErr) return apiErr;
    await refresh();
    return null;
  }, [refresh]);

  return { settings, loading, error, save };
}
```

- [ ] **Step 2: Write the page**

```typescript
import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useDialerSettings } from '../hooks/useDialerSettings';
import type { DialerSaveInput } from '../hooks/useDialerSettings';
import type { DialerProvider } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, SelectField } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';

const PROVIDER_LABELS: Record<DialerProvider, string> = {
  justcall: 'JustCall',
  kixie: 'Kixie',
  aircall: 'Aircall',
};

/** Per-contractor power dialer connection (calling-integration spec §3). No live key validation yet — that lands once a provider is chosen. */
export function DialerConfig() {
  const { settings, loading, error, save } = useDialerSettings();
  const [form, setForm] = useState<DialerSaveInput>({ provider: 'justcall', phone_number: '', api_key: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (settings) {
      setForm((f) => ({ ...f, provider: settings.provider, phone_number: settings.phone_number ?? '' }));
    }
  }, [settings]);

  async function handleSave() {
    setBusy(true); setMsg(null);
    const err = await save(form);
    setBusy(false);
    setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Settings saved.' });
    if (!err) setForm((f) => ({ ...f, api_key: '' }));
  }

  if (loading) return <Skeleton className="h-80 w-full max-w-2xl" />;

  if (error) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h1 className="text-[28px] font-extrabold">Power dialer</h1>
        <Card>
          <p role="alert" className="text-sm text-red-400">Could not load your dialer settings — {error}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <h1 className="text-[28px] font-extrabold">Power dialer</h1>
        {settings?.is_verified && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Verified
          </span>
        )}
      </header>
      <p className="text-muted">
        Connect your dialer account so calls, recordings, and outcomes attach to the right lead automatically.
        Connection testing and live dialing arrive once a provider is fully wired up — for now this saves your
        details so you're ready to go.
      </p>

      <Card>
        <div className="flex flex-col gap-4">
          <SelectField label="Dialer provider" value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as DialerProvider }))}>
            {(Object.keys(PROVIDER_LABELS) as DialerProvider[]).map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </SelectField>

          <Input label="Your dialer phone number" value={form.phone_number} onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))} placeholder="+1 555 123 4567" />
          <Input label="API key" type="password" value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} placeholder={settings ? 'Leave blank to keep the current key' : ''} />

          {msg && <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>}

          <div>
            <Button onClick={() => void handleSave()} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Wire the route**

In `src/App.tsx`, add the import alongside the other page imports:

```typescript
import { DialerConfig } from './pages/DialerConfig';
```

And add the route immediately after the existing `/settings/email` route:

```typescript
              <Route path="/settings/email" element={<EmailConfig />} />
              <Route path="/settings/dialer" element={<DialerConfig />} />
```

- [ ] **Step 4: Add the link card on the Settings hub**

In `src/pages/Settings.tsx`, add a new `Link` card immediately after the existing `/settings/email` link:

```tsx
      <Link to="/settings/email" className="block rounded-xl border border-line bg-card p-5 hover:bg-surface/50">
        <h2 className="text-[18px] font-bold">Email sending</h2>
        <p className="text-sm text-muted">Connect your Gmail/Outlook so Dreamlabs Sales can send from your address.</p>
      </Link>
      <Link to="/settings/dialer" className="block rounded-xl border border-line bg-card p-5 hover:bg-surface/50">
        <h2 className="text-[18px] font-bold">Power dialer</h2>
        <p className="text-sm text-muted">Connect your JustCall/Kixie/Aircall account so calls log automatically.</p>
      </Link>
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual browser verification**

Start the dev server (`npm run dev`), sign in, navigate to `/settings`, confirm the new "Power dialer" card appears and links to `/settings/dialer`. On that page, pick a provider, enter a phone number and a throwaway API key, save, confirm the success message, reload the page, and confirm the provider and phone number persisted (the API key field should be blank again, matching `EmailConfig.tsx`'s behavior). Then delete the throwaway `user_dialer_settings` row created during this test.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useDialerSettings.ts src/pages/DialerConfig.tsx src/pages/Settings.tsx src/App.tsx
git commit -m "feat: add /settings/dialer page for per-contractor dialer connection"
```

---

### Task 5: Call history on the lead detail page

**Files:**
- Modify: `src/components/pipeline/LeadDetailSections.tsx` (add `CallHistorySection`, following the exact pattern of the existing `EmailLogSection` in the same file)
- Modify: `src/pages/LeadDetailPage.tsx` (render the new section)

**Interfaces:**
- Consumes: `Call`/`CallOutcome` types (Task 2); the `calls` table (Task 1); `formatShortDate` from `src/lib/utils`; `EmptyState`/`Skeleton` from `src/components/ui/*` (already imported in this file).
- Produces: `CallHistorySection({ leadId }: { leadId: string })`, a named export from `LeadDetailSections.tsx`.

- [ ] **Step 1: Add the section component**

In `src/components/pipeline/LeadDetailSections.tsx`, add `Phone` to the existing `lucide-react` import (`import { History, Mail, Phone, Repeat } from 'lucide-react';`), then add this after `EmailLogSection`:

```typescript
interface CallRow {
  id: string;
  provider: string;
  direction: 'outbound' | 'inbound';
  outcome: CallOutcome | null;
  duration_seconds: number | null;
  recording_url: string | null;
  created_at: string;
}

const OUTCOME_LABELS: Record<CallOutcome, string> = {
  answered: 'Answered',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  busy: 'Busy',
  failed: 'Failed',
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Calls logged for this lead via a connected power dialer (empty until a provider is connected and wired up). */
export function CallHistorySection({ leadId }: { leadId: string }) {
  const [rows, setRows] = useState<CallRow[] | null>(null);
  useEffect(() => {
    void supabase
      .from('calls').select('id, provider, direction, outcome, duration_seconds, recording_url, created_at').eq('lead_id', leadId).order('created_at', { ascending: false })
      .then(({ data }) => setRows((data as CallRow[] | null) ?? []));
  }, [leadId]);

  if (rows === null) return <Skeleton className="h-16 w-full" />;
  if (rows.length === 0) {
    return <EmptyState icon={Phone} title="No calls yet" hint="Calls made through a connected power dialer will appear here automatically." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between rounded-lg bg-surface/50 p-3 text-sm">
          <span className="truncate font-semibold">
            {r.direction === 'outbound' ? 'Outbound call' : 'Inbound call'}
            {r.outcome && ` · ${OUTCOME_LABELS[r.outcome]}`}
          </span>
          <span className="shrink-0 text-xs text-muted">
            {formatDuration(r.duration_seconds)} {formatShortDate(r.created_at)}
            {r.recording_url && (
              <>
                {' · '}
                <a href={r.recording_url} target="_blank" rel="noreferrer" className="underline">Recording</a>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

Add `CallOutcome` to the existing `import type { LeadNote } from '../../types';` line, making it `import type { CallOutcome, LeadNote } from '../../types';`.

- [ ] **Step 2: Render it on the lead detail page**

In `src/pages/LeadDetailPage.tsx`, change the import on line 19 from:

```typescript
import { ActivityHistory, EmailLogSection } from '../components/pipeline/LeadDetailSections';
```

to:

```typescript
import { ActivityHistory, CallHistorySection, EmailLogSection } from '../components/pipeline/LeadDetailSections';
```

Then add a new `Card` immediately after the existing Emails card (after line 96, before the Sequences card):

```tsx
      <Card>
        <h2 className="mb-2 text-[18px] font-bold">Calls</h2>
        <CallHistorySection leadId={lead.id} />
      </Card>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual browser verification**

With the dev server running, open any lead's detail page and confirm a new "Calls" card renders with the "No calls yet" empty state. Then, using the SQL editor or `mcp__plugin_supabase_supabase__execute_sql`, insert one throwaway row into `calls` for that lead (a real `org_id` matching the lead's org, a fake `external_call_id`, `outcome: 'answered'`, `duration_seconds: 125`) and reload the page — confirm it renders "Outbound call · Answered" with "2:05" and the correct date. Delete the throwaway row afterward.

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/LeadDetailSections.tsx src/pages/LeadDetailPage.tsx
git commit -m "feat: show call history on the lead detail page"
```

---

### Task 6: `/dialer` nav entry — "coming soon" placeholder

**Files:**
- Modify: `src/App.tsx` (add the route)
- Modify: `src/components/layout/Sidebar.tsx` (add the nav entry)

**Interfaces:**
- Consumes: the existing `ComingSoon` component (`src/components/layout/ComingSoon.tsx`, already imported in `App.tsx` — signature `ComingSoon({ module: string })`), already used for `/analytics` in exactly this way.
- Produces: a real, navigable `/dialer` route and Sidebar link. No new files.

- [ ] **Step 1: Add the route**

In `src/App.tsx`, add this route immediately after `/settings/dialer` (from Task 4):

```tsx
              <Route path="/dialer" element={<ComingSoon module="Power Dialer" />} />
```

- [ ] **Step 2: Add the Sidebar nav entry**

In `src/components/layout/Sidebar.tsx`, add `Phone` to the existing `lucide-react` import:

```typescript
import { BarChart3, Contact, KanbanSquare, LayoutDashboard, Mail, Phone, Radar, Rocket, Settings, Shield } from 'lucide-react';
```

Then add an entry to `NAV_ITEMS`, immediately after the `Autopilot` entry and before `Emails` (matching the existing outreach-feature grouping):

```typescript
  { to: '/outreach/autopilot', label: 'Autopilot', icon: Rocket },
  { to: '/dialer', label: 'Power Dialer', icon: Phone },
  { to: '/emails', label: 'Emails', icon: Mail },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual browser verification**

With the dev server running, confirm "Power Dialer" appears in the Sidebar with a phone icon, links to `/dialer`, and renders the same "Power Dialer is coming soon" empty state styling already seen on `/analytics`.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/layout/Sidebar.tsx
git commit -m "feat: add /dialer nav entry with coming-soon placeholder"
```

---

## Explicitly out of scope (deferred to a follow-up plan once a provider is chosen)

- `dialer-settings`'s `test` action and live key validation.
- `dialer-push-queue` (pushing a filtered lead list into the provider's dialer queue).
- `dialer-webhook` (receiving call-outcome callbacks, provider-specific signature verification, `parse-notes` integration for AI call notes).
- The actual functional dialing screen (lead filter/count/start-session UI) behind `/dialer` — Task 6 only adds the placeholder; the real screen replaces it once `dialer-push-queue` exists.
- Phase 2 (AI voice agent) — backlog, per the spec.
