# Cycle 4 — Lead Scraper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the lead scraper module (`SPEC.md` §5): an ICP-driven prospect finder that turns
free text into a scraped, reviewable, approvable list of candidate leads via Google Places (UK+US)
and Companies House (UK), plus optional paid per-lead enrichment via Apollo/Hunter.

**Architecture:** Two new discovery edge functions (`scrape-google-places`,
`scrape-companies-house`) run in the background via Deno's `EdgeRuntime.waitUntil()` — the client
gets an immediate response with a job id and tracks progress via a Supabase Realtime subscription
on `scrape_jobs.status`, exactly as `SPEC.md` already speced. `parse-icp` turns free text into
structured, country-aware search params. Two small synchronous edge functions
(`enrich-apollo`, `enrich-hunter`) handle opt-in, per-lead, paid enrichment, gated behind the
existing `org_api_settings`/`resolveOrgApiKey()` BYO-key pattern extended with two new providers
that deliberately have no Kevin's-orgs global fallback (paid providers, no exceptions). Frontend:
one wizard page (`/scraper`) and one review-table page (`/scraper/jobs/:id`), both fully
`useOrg()`-scoped like every other cycle-3 screen.

**Tech Stack:** React 18/19 + TypeScript, Vite, Tailwind, Supabase (Postgres + Edge Functions/Deno
+ Realtime), Google Places API (Legacy), UK Companies House API, Apollo.io API, Hunter.io API,
Gemini (`gemini-3.6-flash` via the existing `_shared/ai.ts`).

**Spec:** `docs/superpowers/specs/2026-09-02-cycle4-lead-scraper-design.md`

## Global Constraints

- Every new hook/query is `useOrg()`-scoped — no table read/write anywhere omits `org_id` filtering
  on the client side, even though RLS is the real boundary (matches every cycle-3 hook).
- `apollo`/`hunter` never use the global-fallback mechanism, for any org, Kevin's included — always
  `null` from `resolveOrgApiKey()` unless the org configured its own key.
- Supabase background tasks (`EdgeRuntime.waitUntil()`) are capped at **150 seconds on this
  project's current Free plan** — the website-email-discovery concurrency bound must keep the
  worst case (60 results, every site timing out) comfortably under that ceiling.
- TypeScript strict mode, no `any` (cast to `unknown` first if truly needed), named exports only,
  Tailwind utility classes only, components under ~150 lines (extract sub-components if needed) —
  existing repo conventions (`CLAUDE.md`).
- `tsconfig.json` has `noUnusedLocals: true` — every task must run `npx tsc --noEmit` before
  committing and remove any import/destructure that becomes unused as a result of its own changes
  (this has bitten every single cycle-3 task; check for it explicitly, don't just assume it won't).
- Edge functions in this repo have no automated test suite (confirmed: zero test files under
  `supabase/functions/`) — verify them live (`npx supabase functions deploy <name>` +  a real
  authenticated call), matching every prior cycle's convention. Don't invent new edge-function test
  infrastructure that doesn't already exist here.
- Live production database and a live production Supabase project. Migration SQL applies with the
  same append-only, byte-verified-before-apply discipline established in cycle 3 (never edit
  `001_initial_schema.sql`; append new sections to `003_multi_tenant_foundation.sql` or a new
  `004_lead_scraper.sql` file — this plan uses a new file, `004_lead_scraper.sql`, since
  `003_multi_tenant_foundation.sql` is cycle-3-titled and already large; see Task 1).

---

### Task 1: `org_api_settings` — Apollo/Hunter provider support

**Files:**
- Create: `supabase/migrations/004_lead_scraper.sql`
- Modify: `supabase/functions/_shared/orgApiKeys.ts`
- Modify: `supabase/functions/org-api-settings/index.ts`

**Interfaces:**
- Consumes: existing `org_api_settings` table, `resolveOrgApiKey()` (unchanged signature).
- Produces: `ApiProvider` now includes `'apollo'|'hunter'`; `resolveOrgApiKey()` correctly returns
  `null` for both unless the org configured its own key (verified in Step 5).

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/004_lead_scraper.sql
-- ─────────────────────────────────────────
-- CYCLE 4 PART A: apollo + hunter as BYO-key providers (org_api_settings).
-- Deliberately NO global fallback for either — paid providers, every org
-- (Kevin's included) must configure its own key.
-- ─────────────────────────────────────────

ALTER TABLE org_api_settings DROP CONSTRAINT org_api_settings_provider_check;
ALTER TABLE org_api_settings ADD CONSTRAINT org_api_settings_provider_check
  CHECK (provider IN ('gemini','google_places','companies_house','apollo','hunter'));
```

- [ ] **Step 2: Apply and verify**

Apply via the Supabase MCP `execute_sql` tool (or the management-API+`SUPABASE_ACCESS_TOKEN`
pattern if MCP is unavailable) against project `wgomksxelyfkzepbnkdd`. Verify:
`select pg_get_constraintdef(oid) from pg_constraint where conname = 'org_api_settings_provider_check';`
Expected: the new 5-provider list. Confirm no existing `org_api_settings` rows are affected —
`select count(*) from org_api_settings;` should return the same count before and after (this is a
constraint swap, not a data change, so it must be identical).

- [ ] **Step 3: Update `supabase/functions/_shared/orgApiKeys.ts`**

```ts
export type ApiProvider = 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter';

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
};
```
(`resolveOrgApiKey()` itself is unchanged — it's already generic over `ApiProvider`.)

- [ ] **Step 4: Update `supabase/functions/org-api-settings/index.ts`**

Change the `Provider` type and the `save` action's validation, and add two `validateKey` cases.
Full updated file:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

type Provider = 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter';

async function validateKey(provider: Provider, key: string): Promise<string | null> {
  try {
    if (provider === 'gemini') {
      // Keep in sync with AI_MODEL in _shared/ai.ts — gemini-2.5-flash was
      // retired by Google; using a dead model here would reject every valid key.
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }] }) },
      );
      return res.ok ? null : `Gemini rejected the key (HTTP ${res.status})`;
    }
    if (provider === 'google_places') {
      const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=test&key=${key}`);
      const data = await res.json() as { status?: string };
      return data.status === 'REQUEST_DENIED' || data.status === 'INVALID_REQUEST' ? `Google rejected the key (${data.status})` : null;
    }
    if (provider === 'companies_house') {
      const res = await fetch('https://api.company-information.service.gov.uk/search/companies?q=test', {
        headers: { Authorization: 'Basic ' + btoa(`${key}:`) },
      });
      return res.ok ? null : `Companies House rejected the key (HTTP ${res.status})`;
    }
    if (provider === 'apollo') {
      // Free health-check endpoint — does not consume Apollo credits.
      const res = await fetch('https://api.apollo.io/api/v1/auth/health', {
        headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
      });
      return res.ok ? null : `Apollo rejected the key (HTTP ${res.status})`;
    }
    // hunter — /v2/account is Hunter's free account-info call, used purely to verify the key.
    const res = await fetch(`https://api.hunter.io/v2/account?api_key=${key}`);
    return res.ok ? null : `Hunter rejected the key (HTTP ${res.status})`;
  } catch (e) {
    return 'Could not reach the provider to validate the key: ' + (e instanceof Error ? e.message : String(e));
  }
}

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
  if (!userData?.user) return json({ error: 'Not signed in' }, 401, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const body = (await req.json()) as Record<string, unknown>;
  const orgId = String(body.org_id ?? '');
  if (!orgId) return json({ error: 'org_id is required' }, 400, headers);

  const { data: membership } = await service
    .from('org_members').select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  const { data: profile } = await service.from('profiles').select('platform_role').eq('id', userData.user.id).single();
  const canManage = membership?.role === 'admin' || profile?.platform_role === 'platform_admin';
  if (!canManage) return json({ error: 'Org admin only' }, 403, headers);

  if (body.action === 'get') {
    const { data, error } = await service.from('org_api_settings').select('provider, is_configured').eq('org_id', orgId);
    if (error) return json({ error: error.message }, 400, headers);
    return json({ settings: data }, 200, headers);
  }

  if (body.action === 'save') {
    const provider = String(body.provider ?? '') as Provider;
    const apiKey = String(body.api_key ?? '').trim();
    if (!['gemini', 'google_places', 'companies_house', 'apollo', 'hunter'].includes(provider)) return json({ error: 'Invalid provider' }, 400, headers);
    if (!apiKey) return json({ error: 'api_key is required' }, 400, headers);

    const validationError = await validateKey(provider, apiKey);
    if (validationError) return json({ error: validationError }, 400, headers);

    const { error: vaultErr } = await service.rpc('app_set_org_api_key', { target_org: orgId, target_provider: provider, secret: apiKey });
    if (vaultErr) return json({ error: 'Could not store the key: ' + vaultErr.message }, 500, headers);
    const { error: upsertErr } = await service.from('org_api_settings').upsert(
      { org_id: orgId, provider, is_configured: true, updated_at: new Date().toISOString() },
      { onConflict: 'org_id,provider' },
    );
    if (upsertErr) return json({ error: upsertErr.message }, 400, headers);
    return json({ ok: true }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
```

- [ ] **Step 5: Deploy and live-verify**

```bash
npx supabase functions deploy org-api-settings
```
Verify with a real authenticated `save` call for `apollo` using an actual (or deliberately invalid,
to confirm rejection) key against your own org — confirm a valid key returns `{ok:true}` and shows
as configured via a `get` call; confirm an invalid key returns the `Apollo rejected the key` message,
not a generic error. Then confirm `resolveOrgApiKey()`'s no-fallback guarantee: for an org **without**
an Apollo key configured, `select * from organizations where id = '<any org>';` — regardless of its
`use_global_api_fallback` value — a call into any function using `resolveOrgApiKey(service, orgId, 'apollo')`
must return `null` (there is no live consumer of this yet at this point in the plan; this becomes
concretely testable once Task 7 exists — note it here, re-verify in Task 7's own verification step).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/004_lead_scraper.sql supabase/functions/_shared/orgApiKeys.ts supabase/functions/org-api-settings/index.ts
git commit -m "feat: apollo + hunter BYO-key providers, no global fallback"
```

---

### Task 2: Settings UI — Apollo/Hunter connect rows

**Files:**
- Modify: `src/hooks/useOrgApiSettings.ts`
- Modify: `src/pages/OrganizationSettings.tsx`

**Interfaces:**
- Consumes: `ProviderGuide` (`src/components/settings/ProviderGuide.tsx`, unchanged), the
  `org-api-settings` edge function from Task 1.
- Produces: nothing new consumed elsewhere — this is a leaf UI change.

- [ ] **Step 1: Update `OrgApiSetting['provider']` in `src/hooks/useOrgApiSettings.ts`**

Change:
```ts
export interface OrgApiSetting {
  provider: 'gemini' | 'google_places' | 'companies_house';
  is_configured: boolean;
}
```
to:
```ts
export interface OrgApiSetting {
  provider: 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter';
  is_configured: boolean;
}
```
No other change needed in this file — `save`/`refresh` are already generic over `provider`.

- [ ] **Step 2: Add Apollo/Hunter to the `PROVIDERS` array in `src/pages/OrganizationSettings.tsx`**

Append two entries to the existing `PROVIDERS` array (after the `companies_house` entry), matching
the shape already established by Task 10-era work (`url`/`ctaLabel`/`freeText`/optional `steps`):

```ts
  {
    key: 'apollo',
    label: 'Apollo.io (optional lead enrichment)',
    url: 'https://app.apollo.io/#/settings/integrations/api',
    ctaLabel: 'Get your Apollo API key →',
    freeText: "Paid — Apollo's free plan has no API access, so this needs a paid Apollo plan. Usage bills to your own Apollo account, never Kevin's. Entirely optional: only appears as an \"Enrich with Apollo\" button on individual leads if configured — nothing runs automatically.",
  },
  {
    key: 'hunter',
    label: 'Hunter.io (optional email finder)',
    url: 'https://hunter.io/api-keys',
    ctaLabel: 'Get your Hunter API key →',
    freeText: "Hunter's free plan includes some monthly credits but API access requires a paid plan. Usage bills to your own Hunter account, never Kevin's. Entirely optional: only appears as a \"Find email with Hunter\" button on individual leads if configured.",
  },
```

- [ ] **Step 3: Typecheck and test**

```bash
npx tsc --noEmit && npx vitest run
```
Expected: clean, 48/48 (no new tests added by this task — it's a data-driven UI extension of an
already-tested pattern).

- [ ] **Step 4: Browser-verify**

Navigate to `/settings/organization` as an org admin. Confirm two new rows render below Companies
House with the "paid" framing clearly visible, each with a working external-link button. Confirm
the existing three rows are visually unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOrgApiSettings.ts src/pages/OrganizationSettings.tsx
git commit -m "feat: Apollo/Hunter connect rows in organization settings"
```

---

### Task 3: Types — `ScrapeJob`, `RawLead`, `IcpParams`

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `ScrapeJobStatus`, `ScrapeSource`, `ScrapeJob`, `RawLeadStatus`, `RawLead`, `IcpParams` —
  every later frontend task imports these from `../types`.

- [ ] **Step 1: Add the new types**

Append to `src/types/index.ts` (after the existing `LeadSuggestion` interface):

```ts
export type ScrapeJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ScrapeSource = 'google_places' | 'companies_house';

export interface ScrapeJob {
  id: string;
  icp_raw_input: string | null;
  icp_params: IcpParams | null;
  sources: ScrapeSource[];
  status: ScrapeJobStatus;
  results_count: number;
  approved_count: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type RawLeadStatus = 'pending' | 'approved' | 'rejected' | 'duplicate';

export interface RawLead {
  id: string;
  scrape_job_id: string;
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
  source: 'google_places' | 'companies_house';
  source_id: string | null;
  raw_data: Record<string, unknown> | null;
  status: RawLeadStatus;
  duplicate_of: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

/** Structured output of parse-icp — country drives the Companies House checkbox gate. */
export interface IcpParams {
  industry: string | null;
  location: string | null;
  city: string | null;
  country: 'GB' | 'US' | 'other';
  min_staff: number | null;
  min_rating: number | null;
  max_rating: number | null;
  max_reviews: number | null;
  keywords: string[];
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean (these are new, unreferenced types — nothing to break yet).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: scraper types (ScrapeJob, RawLead, IcpParams)"
```

---

### Task 4: Edge function — `parse-icp`

**Files:**
- Create: `supabase/functions/parse-icp/index.ts`

**Interfaces:**
- Consumes: `resolveOrgApiKey()` (Task 1's `_shared/orgApiKeys.ts`), `_shared/cors.ts`,
  `_shared/ai.ts`'s `AI_MODEL` constant (for the raw Gemini call — this function doesn't reuse
  `draftEmail()`/`parseNotes()`, it makes its own `geminiJson`-shaped call since its prompt/schema
  is unrelated to email drafting).
- Produces: `IcpParams` shape (Task 3) as the response body's `params` field — every later task
  that calls `parse-icp` expects exactly this shape back.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/parse-icp/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const AI_MODEL = 'gemini-3.6-flash'; // keep in sync with _shared/ai.ts

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

  const body = (await req.json()) as { raw_input?: string; org_id?: string };
  const rawInput = String(body.raw_input ?? '').trim();
  const orgId = String(body.org_id ?? '');
  if (!rawInput) return json({ error: 'raw_input is required' }, 400, headers);
  if (!orgId) return json({ error: 'org_id is required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const apiKey = await resolveOrgApiKey(service, orgId, 'gemini');
  if (!apiKey) return json({ error: 'No Gemini API key configured for this organization' }, 400, headers);

  const prompt = `You are an ICP parser for a B2B sales tool. Convert the user's natural language
description of their ideal customer into structured JSON search parameters.

Return ONLY valid JSON matching this exact shape, no other text:
{"industry": string|null, "location": string|null, "city": string|null, "country": "GB"|"US"|"other", "min_staff": number|null, "min_rating": number|null, "max_rating": number|null, "max_reviews": number|null, "keywords": string[]}

"country" must be "GB" if the location is in the United Kingdom, "US" if in the United States, "other" otherwise.
If the user gives a rating range, split it into min_rating/max_rating. If unspecified, use null.
"keywords" is a short list of extra search terms useful for a location-based business search (e.g. the industry name, near-synonyms).

USER'S DESCRIPTION:
${rawInput}`;

  try {
    const res = await fetch(`${GEMINI_URL}/${AI_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    });
    if (!res.ok) return json({ error: `Gemini ${res.status}: ${(await res.text()).slice(0, 300)}` }, 502, headers);
    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: 'Gemini returned no content' }, 502, headers);
    const params = JSON.parse(text);
    return json({ params }, 200, headers);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500, headers);
  }
});
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy parse-icp
```

- [ ] **Step 3: Live-verify**

Call it with a real authenticated request, `{"raw_input":"Commercial cleaning companies in London, 10-30 staff, rating between 3.0 and 4.2, fewer than 30 reviews","org_id":"<DI Dreamlabs org id>"}`.
Expected: `params.country === "GB"`, `params.location` mentions London, `min_staff`/`max_reviews`
roughly match, `min_rating`≈3.0/`max_rating`≈4.2. Also test a US input ("SaaS companies in Austin,
Texas") and confirm `country === "US"`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/parse-icp
git commit -m "feat: parse-icp edge function"
```

---

### Task 5: Edge function — `scrape-google-places`

**Files:**
- Create: `supabase/functions/_shared/concurrency.ts`
- Create: `supabase/functions/scrape-google-places/index.ts`

**Interfaces:**
- Produces: `runBounded<T, R>(items, limit, fn)` in `_shared/concurrency.ts` — Task 6 imports this
  same helper rather than redefining it (DRY; matches the existing `_shared/` cross-function-import
  convention already used by `cors.ts`/`ai.ts`/`orgApiKeys.ts`).
- Consumes: `resolveOrgApiKey()` (provider `'google_places'`), `_shared/cors.ts`, `IcpParams`
  shape from `parse-icp` (Task 4) as input.
- Produces: writes rows to `raw_leads` with `source='google_places'`; updates `scrape_jobs.status`/
  `results_count`/`completed_at`/`error_message`. Later tasks (the review UI) read these via
  normal Supabase client queries, not via this function's response — this function's HTTP response
  only returns the created `job_id` immediately, before the real work is done.

This is the largest function in the cycle — it owns Google Places search, pagination, per-result
Place Details lookup, best-effort website email discovery, and org-scoped duplicate detection, all
inside a single `EdgeRuntime.waitUntil()` background task.

- [ ] **Step 1: Write `_shared/concurrency.ts`**

```ts
// supabase/functions/_shared/concurrency.ts
/** Runs up to `limit` promises at once, in order, waiting for a free slot before starting the next. */
export async function runBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
```

- [ ] **Step 2: Write the scrape function**

```ts
// supabase/functions/scrape-google-places/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { runBounded } from '../_shared/concurrency.ts';

interface IcpParams {
  industry: string | null; location: string | null; city: string | null;
  country: 'GB' | 'US' | 'other'; min_staff: number | null;
  min_rating: number | null; max_rating: number | null; max_reviews: number | null;
  keywords: string[];
}

interface PlaceResult {
  place_id: string; name: string; formatted_address?: string;
  rating?: number; user_ratings_total?: number;
}

/** Best-effort: fetch a business website and pull the first plausible contact email from it. */
async function findEmail(website: string | undefined): Promise<string | null> {
  if (!website) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(website, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    const mailto = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (mailto) return mailto[1];
    const plain = html.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/);
    return plain ? plain[0] : null;
  } catch {
    return null; // timeout, network error, or a hostile/broken site — never fail the job for this
  }
}

async function fetchPlaceDetails(placeId: string, apiKey: string): Promise<{ phone: string | null; website: string | null }> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return { phone: null, website: null };
  const data = await res.json() as { result?: { formatted_phone_number?: string; website?: string } };
  return { phone: data.result?.formatted_phone_number ?? null, website: data.result?.website ?? null };
}

function buildQuery(icp: IcpParams): string {
  const parts = [icp.industry, icp.city ?? icp.location, ...icp.keywords].filter(Boolean);
  return parts.join(' ');
}

async function runScrapeJob(service: SupabaseClient, jobId: string, orgId: string, icp: IcpParams, apiKey: string) {
  try {
    await service.from('scrape_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', jobId);

    const query = buildQuery(icp);
    const allPlaces: PlaceResult[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 3 && allPlaces.length < 60; page++) {
      const url = pageToken
        ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pageToken}&key=${apiKey}`
        : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
      const res = await fetch(url);
      const data = await res.json() as { results?: PlaceResult[]; next_page_token?: string; status: string };
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        throw new Error(`Google Places ${data.status}`);
      }
      allPlaces.push(...(data.results ?? []));
      pageToken = data.next_page_token;
      if (!pageToken) break;
      // Google requires a short delay before a next_page_token becomes valid.
      await new Promise((r) => setTimeout(r, 2000));
    }
    const places = allPlaces.slice(0, 60);

    // Existing org data for duplicate detection — fetched once, matched in-memory.
    const { data: existingLeads } = await service.from('leads')
      .select('business_name, city, email').eq('org_id', orgId);
    const { data: existingRaw } = await service.from('raw_leads')
      .select('business_name, city, email, scrape_jobs!inner(org_id)').eq('scrape_jobs.org_id', orgId).eq('status', 'pending');
    const seen = [...(existingLeads ?? []), ...(existingRaw ?? [])];
    function isDuplicate(businessName: string, city: string | null, email: string | null): boolean {
      return seen.some((s) =>
        (s.email && email && s.email.toLowerCase() === email.toLowerCase()) ||
        (s.business_name.toLowerCase() === businessName.toLowerCase() && (s.city ?? '').toLowerCase() === (city ?? '').toLowerCase()),
      );
    }

    // Bounded concurrency: Place Details + website email lookup per result.
    // Sized to comfortably clear 60 results inside Supabase's 150s Free-plan
    // background-task ceiling even if every site times out (concurrency 8 x
    // ~5s worst case per item = ~38s for 60 items).
    const enriched = await runBounded(places, 8, async (place) => {
      const details = await fetchPlaceDetails(place.place_id, apiKey);
      const email = await findEmail(details.website ?? undefined);
      return { place, details, email };
    });

    const rows = enriched.map(({ place, details, email }) => {
      const city = icp.city ?? null;
      const duplicate = isDuplicate(place.name, city, email);
      return {
        scrape_job_id: jobId,
        business_name: place.name,
        phone: details.phone,
        email,
        website: details.website,
        address: place.formatted_address ?? null,
        city,
        google_rating: place.rating ?? null,
        review_count: place.user_ratings_total ?? null,
        vertical: icp.industry,
        source: 'google_places',
        source_id: place.place_id,
        raw_data: { place, details },
        status: duplicate ? 'duplicate' : 'pending',
      };
    });

    if (rows.length > 0) {
      const { error: insertErr } = await service.from('raw_leads').insert(rows);
      if (insertErr) throw new Error(insertErr.message);
    }

    await service.from('scrape_jobs').update({
      status: 'completed', results_count: rows.length, completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  } catch (e) {
    await service.from('scrape_jobs').update({
      status: 'failed', error_message: e instanceof Error ? e.message : String(e), completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  }
}

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

  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams };
  const orgId = String(body.org_id ?? '');
  if (!orgId || !body.icp_params) return json({ error: 'org_id and icp_params are required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const apiKey = await resolveOrgApiKey(service, orgId, 'google_places');
  if (!apiKey) return json({ error: 'No Google Places API key configured for this organization' }, 400, headers);

  const { data: job, error: jobErr } = await service.from('scrape_jobs').insert({
    org_id: orgId, created_by: userData.user.id, icp_raw_input: body.icp_raw_input ?? null,
    icp_params: body.icp_params, sources: ['google_places'], status: 'pending',
  }).select('id').single();
  if (jobErr || !job) return json({ error: jobErr?.message ?? 'Could not create job' }, 500, headers);

  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(runScrapeJob(service, job.id, orgId, body.icp_params, apiKey));

  return json({ job_id: job.id }, 200, headers);
});
```

- [ ] **Step 3: Deploy**

```bash
npx supabase functions deploy scrape-google-places
```

- [ ] **Step 4: Live-verify end-to-end**

Confirm your org (DI Dreamlabs or Mr Brush & Co) has a Google Places key configured (global
fallback applies to both). Call the function with a real authenticated request and a real
`icp_params` object (use Task 4's `parse-icp` output directly). Confirm:
1. The HTTP response returns immediately with a `job_id` (should be well under a second).
2. Polling `select status, results_count from scrape_jobs where id = '<job_id>';` shows
   `pending` → `running` → `completed` over the following seconds/tens of seconds.
3. `select business_name, phone, email, status from raw_leads where scrape_job_id = '<job_id>';`
   shows real results with at least some phone numbers populated (email may be null for sites
   where discovery failed — that's expected, not a bug).
4. Run it twice in a row with the same ICP for the same org — confirm the second run's results
   are correctly flagged `status='duplicate'` where they match the first run's `business_name`.
5. Confirm the whole job (60-result case if you have an ICP broad enough to return that many)
   completes well inside 150 seconds — time it.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/concurrency.ts supabase/functions/scrape-google-places
git commit -m "feat: scrape-google-places edge function (background, org-scoped, deduped)"
```

---

### Task 6: Edge function — `scrape-companies-house`

**Files:**
- Create: `supabase/functions/scrape-companies-house/index.ts`

**Interfaces:**
- Consumes: `resolveOrgApiKey()` (provider `'companies_house'`), `runBounded()` from
  `_shared/concurrency.ts` (Task 5 Step 1 — do not redefine it here), same job-creation/background
  shape as Task 5.
- Produces: writes rows to `raw_leads` with `source='companies_house'`.

- [ ] **Step 1: Write the function**

Companies House has no phone/email/rating — `owner_name` comes from the first listed officer role
where available (kept simple: the search endpoint itself doesn't return officers, only the
company profile does, so this function does a second lookup per company, same bounded-concurrency
shape as Task 5's Place Details step, capped lower since Companies House has stricter rate limits
than Google).

```ts
// supabase/functions/scrape-companies-house/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { runBounded } from '../_shared/concurrency.ts';

interface IcpParams {
  industry: string | null; location: string | null; city: string | null;
  country: 'GB' | 'US' | 'other'; keywords: string[];
}

interface CHCompany {
  company_number: string; title: string;
  address_snippet?: string;
}

async function fetchFirstOfficer(companyNumber: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.company-information.service.gov.uk/company/${companyNumber}/officers`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) return null;
    const data = await res.json() as { items?: { name?: string }[] };
    return data.items?.[0]?.name ?? null;
  } catch {
    return null;
  }
}

async function runScrapeJob(service: SupabaseClient, jobId: string, orgId: string, icp: IcpParams, apiKey: string) {
  try {
    await service.from('scrape_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', jobId);

    const query = [icp.industry, icp.city ?? icp.location, ...icp.keywords].filter(Boolean).join(' ');
    const res = await fetch(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query)}&items_per_page=30`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) throw new Error(`Companies House HTTP ${res.status}`);
    const data = await res.json() as { items?: CHCompany[] };
    const companies = (data.items ?? []).slice(0, 30);

    const { data: existingLeads } = await service.from('leads').select('business_name, city').eq('org_id', orgId);
    const { data: existingRaw } = await service.from('raw_leads')
      .select('business_name, city, scrape_jobs!inner(org_id)').eq('scrape_jobs.org_id', orgId).eq('status', 'pending');
    const seen = [...(existingLeads ?? []), ...(existingRaw ?? [])];
    function isDuplicate(businessName: string): boolean {
      return seen.some((s) => s.business_name.toLowerCase() === businessName.toLowerCase());
    }

    const owners = await runBounded(companies, 5, (c) => fetchFirstOfficer(c.company_number, apiKey));

    const rows = companies.map((c, i) => ({
      scrape_job_id: jobId,
      business_name: c.title,
      owner_name: owners[i],
      address: c.address_snippet ?? null,
      vertical: icp.industry,
      source: 'companies_house',
      source_id: c.company_number,
      raw_data: { company: c },
      status: isDuplicate(c.title) ? 'duplicate' : 'pending',
    }));

    if (rows.length > 0) {
      const { error: insertErr } = await service.from('raw_leads').insert(rows);
      if (insertErr) throw new Error(insertErr.message);
    }

    await service.from('scrape_jobs').update({
      status: 'completed', results_count: rows.length, completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  } catch (e) {
    await service.from('scrape_jobs').update({
      status: 'failed', error_message: e instanceof Error ? e.message : String(e), completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  }
}

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

  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams };
  const orgId = String(body.org_id ?? '');
  if (!orgId || !body.icp_params) return json({ error: 'org_id and icp_params are required' }, 400, headers);
  if (body.icp_params.country !== 'GB') return json({ error: 'Companies House only covers UK companies' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Caller must belong to the org they're asking to scrape into — found missing
  // in Task 5's review (Critical: cross-tenant scrape + API-spend theft), fixed
  // here proactively before this code was ever transcribed.
  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const apiKey = await resolveOrgApiKey(service, orgId, 'companies_house');
  if (!apiKey) return json({ error: 'No Companies House API key configured for this organization' }, 400, headers);

  const { data: job, error: jobErr } = await service.from('scrape_jobs').insert({
    org_id: orgId, created_by: userData.user.id, icp_raw_input: body.icp_raw_input ?? null,
    icp_params: body.icp_params, sources: ['companies_house'], status: 'pending',
  }).select('id').single();
  if (jobErr || !job) return json({ error: jobErr?.message ?? 'Could not create job' }, 500, headers);

  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(runScrapeJob(service, job.id, orgId, body.icp_params, apiKey));

  return json({ job_id: job.id }, 200, headers);
});
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy scrape-companies-house
```

- [ ] **Step 3: Live-verify**

Same shape as Task 5 Step 3: confirm immediate `job_id` response, `pending`→`running`→`completed`
transition, real `raw_leads` rows with `source='companies_house'`, and confirm a non-GB
`icp_params.country` is rejected with the 400 before any job row is even created (check
`scrape_jobs` count is unchanged after a rejected US-ICP call).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/scrape-companies-house
git commit -m "feat: scrape-companies-house edge function"
```

---

### Task 7: Edge functions — `enrich-apollo` + `enrich-hunter`

**Files:**
- Create: `supabase/functions/_shared/domain.ts`
- Create: `supabase/functions/enrich-apollo/index.ts`
- Create: `supabase/functions/enrich-hunter/index.ts`

**Interfaces:**
- Produces: `bareDomain(website: string): string | null` in `_shared/domain.ts` — both enrichment
  functions import this shared helper rather than each defining their own copy (DRY, same
  cross-function `_shared/` convention as `runBounded` in Task 5).
- Consumes: `resolveOrgApiKey()` (providers `'apollo'`/`'hunter'`), a single `raw_lead_id`.
- Produces: updates the one `raw_leads` row's `email`/`owner_name` in place (only when the
  provider actually returned a better value), stashes the full raw response under
  `raw_data.enrichment.apollo`/`raw_data.enrichment.hunter`.

Both are small, synchronous, single-lead calls — no background execution needed.

- [ ] **Step 1: Write `_shared/domain.ts`**

```ts
// supabase/functions/_shared/domain.ts
/** Strips protocol and leading www. to get a bare domain Apollo/Hunter expect (e.g. "example.com"). */
export function bareDomain(website: string): string | null {
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Write `enrich-apollo/index.ts`**

```ts
// supabase/functions/enrich-apollo/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { bareDomain } from '../_shared/domain.ts';

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

  const body = (await req.json()) as { raw_lead_id?: string };
  const rawLeadId = String(body.raw_lead_id ?? '');
  if (!rawLeadId) return json({ error: 'raw_lead_id is required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Derive org_id from the lead itself via a service-role join — never trust a
  // client-supplied org_id here. (Found in Task 5's review: a caller who owns
  // a lead in Org A could otherwise pass org_id=OrgB in the body and steal
  // Org B's Apollo credits to enrich Org A's lead. Deriving org_id from the
  // lead's own scrape_job closes this off entirely — there's no org_id
  // parameter left to spoof.)
  const { data: rawLead, error: readErr } = await service
    .from('raw_leads')
    .select('id, website, email, owner_name, raw_data, scrape_jobs!inner(org_id)')
    .eq('id', rawLeadId).single();
  if (readErr || !rawLead) return json({ error: 'Lead not found' }, 404, headers);
  const orgId = (rawLead.scrape_jobs as unknown as { org_id: string }).org_id;

  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const apiKey = await resolveOrgApiKey(service, orgId, 'apollo');
  if (!apiKey) return json({ error: 'No Apollo API key configured for this organization' }, 400, headers);

  const domain = bareDomain(rawLead.website ?? '');
  if (!domain) return json({ error: 'This lead has no usable website domain to enrich against' }, 400, headers);

  const res = await fetch(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return json({ error: `Apollo HTTP ${res.status}` }, 502, headers);
  const data = await res.json() as { organization?: { primary_phone?: { number?: string }; name?: string } };
  const org = data.organization;
  if (!org) return json({ error: 'Apollo found no match for this domain' }, 404, headers);

  const existingRawData = (rawLead.raw_data ?? {}) as Record<string, unknown>;
  const existingEnrichment = (existingRawData.enrichment ?? {}) as Record<string, unknown>;
  const { error: updateErr } = await service.from('raw_leads').update({
    raw_data: { ...existingRawData, enrichment: { ...existingEnrichment, apollo: org } },
  }).eq('id', rawLeadId);
  if (updateErr) return json({ error: updateErr.message }, 500, headers);

  return json({ ok: true, organization: org }, 200, headers);
});
```

- [ ] **Step 3: Write `enrich-hunter/index.ts`**

```ts
// supabase/functions/enrich-hunter/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { bareDomain } from '../_shared/domain.ts';

interface HunterEmail { value: string; type: string; confidence: number; first_name?: string; last_name?: string; position?: string }

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

  const body = (await req.json()) as { raw_lead_id?: string };
  const rawLeadId = String(body.raw_lead_id ?? '');
  if (!rawLeadId) return json({ error: 'raw_lead_id is required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Derive org_id from the lead itself via a service-role join — never trust a
  // client-supplied org_id here. Same fix as enrich-apollo, see its comment.
  const { data: rawLead, error: readErr } = await service
    .from('raw_leads')
    .select('id, website, email, raw_data, scrape_jobs!inner(org_id)')
    .eq('id', rawLeadId).single();
  if (readErr || !rawLead) return json({ error: 'Lead not found' }, 404, headers);
  const orgId = (rawLead.scrape_jobs as unknown as { org_id: string }).org_id;

  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const apiKey = await resolveOrgApiKey(service, orgId, 'hunter');
  if (!apiKey) return json({ error: 'No Hunter API key configured for this organization' }, 400, headers);

  const domain = bareDomain(rawLead.website ?? '');
  if (!domain) return json({ error: 'This lead has no usable website domain to search' }, 400, headers);

  const res = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`);
  if (!res.ok) return json({ error: `Hunter HTTP ${res.status}` }, 502, headers);
  const data = await res.json() as { data?: { emails?: HunterEmail[] } };
  const emails = data.data?.emails ?? [];
  if (emails.length === 0) return json({ error: 'Hunter found no emails for this domain' }, 404, headers);

  // Highest-confidence email wins; only overwrite the lead's email if we don't already have a better one.
  const best = [...emails].sort((a, b) => b.confidence - a.confidence)[0];

  const existingRawData = (rawLead.raw_data ?? {}) as Record<string, unknown>;
  const existingEnrichment = (existingRawData.enrichment ?? {}) as Record<string, unknown>;
  const { error: updateErr } = await service.from('raw_leads').update({
    email: rawLead.email ?? best.value,
    raw_data: { ...existingRawData, enrichment: { ...existingEnrichment, hunter: { emails } } },
  }).eq('id', rawLeadId);
  if (updateErr) return json({ error: updateErr.message }, 500, headers);

  return json({ ok: true, best_email: best.value, confidence: best.confidence }, 200, headers);
});
```

- [ ] **Step 4: Deploy both**

```bash
npx supabase functions deploy enrich-apollo
npx supabase functions deploy enrich-hunter
```

- [ ] **Step 5: Live-verify (completing Task 1 Step 5's deferred check too)**

For an org **without** Apollo/Hunter configured: call both functions for a real `raw_lead_id`
belonging to that org — confirm both return the `No <Provider> API key configured` 400, proving
`resolveOrgApiKey()` really does return `null` with zero fallback (this is the concrete test that
Task 1 Step 5 deferred to this point). Then, for an org **with** a real key configured (use your
own Apollo/Hunter account if you have one, even on a low tier — a 502 from a genuinely-invalid
domain is still proof the function reached the provider correctly): confirm a successful call
updates `raw_leads.raw_data.enrichment.apollo`/`.hunter` and, for Hunter, `email` when it was
previously null.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/domain.ts supabase/functions/enrich-apollo supabase/functions/enrich-hunter
git commit -m "feat: enrich-apollo + enrich-hunter edge functions (opt-in, per-lead, paid)"
```

---

### Task 8: Hooks — `useScrapeJob`, `useRawLeadActions`

**Files:**
- Create: `src/hooks/useScrapeJob.ts`
- Create: `src/hooks/useRawLeadActions.ts`

**Interfaces:**
- Consumes: `useOrg()`, `supabase` client, `ScrapeJob`/`RawLead` types (Task 3).
- Produces: `useScrapeJob(jobId)` → `{ job, rawLeads, loading, error, refresh }`;
  `useRawLeadActions()` → `{ approve, reject, skip, enrichWithApollo, enrichWithHunter }`, each
  `(rawLead: RawLead) => Promise<string | null>` (error message or `null` on success) — the review
  table (Task 10) consumes both hooks directly.

- [ ] **Step 1: Write `useScrapeJob.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ScrapeJob, RawLead } from '../types';

/** A single scrape job + its raw leads, realtime-subscribed to both. */
export function useScrapeJob(jobId: string) {
  const [job, setJob] = useState<ScrapeJob | null>(null);
  const [rawLeads, setRawLeads] = useState<RawLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [jobRes, leadsRes] = await Promise.all([
      supabase.from('scrape_jobs').select('*').eq('id', jobId).single(),
      supabase.from('raw_leads').select('*').eq('scrape_job_id', jobId).order('created_at'),
    ]);
    if (jobRes.error) setError(jobRes.error.message);
    else { setJob(jobRes.data as ScrapeJob); setError(null); }
    if (!leadsRes.error) setRawLeads((leadsRes.data as RawLead[] | null) ?? []);
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel(`scrape-job-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scrape_jobs', filter: `id=eq.${jobId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_leads', filter: `scrape_job_id=eq.${jobId}` }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, refresh]);

  return { job, rawLeads, loading, error, refresh };
}
```

- [ ] **Step 2: Write `useRawLeadActions.ts`**

```ts
import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import { useAuth } from './useAuth';
import type { RawLead } from '../types';

/** Approve/reject/skip a raw_leads row, plus the two paid enrichment actions. */
export function useRawLeadActions() {
  const { currentOrg } = useOrg();
  const { session } = useAuth();

  const approve = useCallback(async (lead: RawLead): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    const { error: insertErr } = await supabase.from('leads').insert({
      business_name: lead.business_name, owner_name: lead.owner_name, phone: lead.phone,
      email: lead.email, website: lead.website, address: lead.address, city: lead.city,
      postcode: lead.postcode, google_rating: lead.google_rating, review_count: lead.review_count,
      vertical: lead.vertical, stage: 'new_lead', org_id: currentOrg.id,
      created_by: session?.user.id, raw_lead_id: lead.id,
    });
    if (insertErr) return insertErr.message;
    const { error: updateErr } = await supabase.from('raw_leads').update({
      status: 'approved', approved_by: session?.user.id, approved_at: new Date().toISOString(),
    }).eq('id', lead.id);
    return updateErr ? updateErr.message : null;
  }, [currentOrg, session]);

  const reject = useCallback(async (lead: RawLead): Promise<string | null> => {
    const { error } = await supabase.from('raw_leads').update({ status: 'rejected' }).eq('id', lead.id);
    return error ? error.message : null;
  }, []);

  const skip = useCallback(async (): Promise<string | null> => {
    return null; // "Skip" is a no-op — the row simply stays status='pending' for a later session.
  }, []);

  const enrichWithApollo = useCallback(async (lead: RawLead): Promise<string | null> => {
    // No org_id sent — enrich-apollo derives it authoritatively from the lead
    // itself server-side (see Task 7), so there's nothing here to spoof.
    const { data, error } = await supabase.functions.invoke('enrich-apollo', {
      body: { raw_lead_id: lead.id },
    });
    if (error) return error.message;
    return (data as { error?: string }).error ?? null;
  }, []);

  const enrichWithHunter = useCallback(async (lead: RawLead): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke('enrich-hunter', {
      body: { raw_lead_id: lead.id },
    });
    if (error) return error.message;
    return (data as { error?: string }).error ?? null;
  }, []);

  return { approve, reject, skip, enrichWithApollo, enrichWithHunter };
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean (both hooks are new and self-contained; nothing consumes them yet, so no
downstream breakage possible at this point).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useScrapeJob.ts src/hooks/useRawLeadActions.ts
git commit -m "feat: useScrapeJob + useRawLeadActions hooks"
```

---

### Task 9: UI — Scraper wizard (`/scraper`)

**Files:**
- Create: `src/pages/Scraper.tsx`

**Interfaces:**
- Consumes: `useOrg()`, `useOrgApiSettings()` (Task 2, to check which sources are actually
  configured for this org before offering them), `StepProgress`/`Textarea`/`Button`/`Card` (`ui/`),
  `IcpParams` (Task 3), `parse-icp`/`scrape-google-places`/`scrape-companies-house` edge functions.
- Produces: on successful scrape trigger, navigates to `/scraper/jobs/:id` (Task 10 owns that route).

- [ ] **Step 1: Write the wizard**

```tsx
// src/pages/Scraper.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Radar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import { useOrgApiSettings } from '../hooks/useOrgApiSettings';
import { StepProgress } from '../components/ui/StepProgress';
import { Textarea } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import type { IcpParams, ScrapeSource } from '../types';

const TOTAL_STEPS = 4;

/** 4-step lead-scraper wizard: ICP text -> AI parse -> pick sources -> confirm+scrape (SPEC.md §5). */
export function Scraper() {
  const navigate = useNavigate();
  const { currentOrg } = useOrg();
  const { settings } = useOrgApiSettings();
  const [step, setStep] = useState(1);
  const [rawInput, setRawInput] = useState('');
  const [icp, setIcp] = useState<IcpParams | null>(null);
  const [source, setSource] = useState<ScrapeSource>('google_places');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placesConfigured = settings.find((s) => s.provider === 'google_places')?.is_configured ?? false;
  const chConfigured = settings.find((s) => s.provider === 'companies_house')?.is_configured ?? false;

  async function parseIcp() {
    if (!currentOrg || !rawInput.trim()) return;
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.functions.invoke('parse-icp', {
      body: { raw_input: rawInput, org_id: currentOrg.id },
    });
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

  async function runScrape() {
    if (!currentOrg || !icp) return;
    setBusy(true); setError(null);
    const functionName = source === 'google_places' ? 'scrape-google-places' : 'scrape-companies-house';
    const { data, error: err } = await supabase.functions.invoke(functionName, {
      body: { org_id: currentOrg.id, icp_raw_input: rawInput, icp_params: icp },
    });
    setBusy(false);
    if (err) return setError(err.message);
    const result = data as { job_id?: string; error?: string };
    if (result.error) return setError(result.error);
    if (result.job_id) navigate(`/scraper/jobs/${result.job_id}`);
  }

  const sourceUnavailable =
    source === 'google_places' ? !placesConfigured : icp?.country !== 'GB' || !chConfigured;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-3">
        <Radar className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">Find leads</h1>
      </header>
      <StepProgress step={step} total={TOTAL_STEPS} />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {step === 1 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Describe your ideal customer</p>
            <Textarea
              label="ICP description"
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="Commercial cleaning companies in London, 10-30 staff, rating between 3.0 and 4.2, fewer than 30 reviews"
            />
            <Button onClick={() => void parseIcp()} disabled={busy || !rawInput.trim()}>
              {busy ? 'Reading…' : 'Continue'}
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && icp && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Here's what I picked up</p>
            <div className="flex flex-wrap gap-2">
              {icp.location && <Badge className="bg-violet/15 text-violet">Location: {icp.location}</Badge>}
              {icp.industry && <Badge className="bg-violet/15 text-violet">Industry: {icp.industry}</Badge>}
              {icp.min_staff != null && <Badge className="bg-violet/15 text-violet">Min staff: {icp.min_staff}</Badge>}
              {(icp.min_rating != null || icp.max_rating != null) && (
                <Badge className="bg-violet/15 text-violet">Rating: {icp.min_rating ?? '?'}–{icp.max_rating ?? '?'}</Badge>
              )}
              {icp.max_reviews != null && <Badge className="bg-violet/15 text-violet">Max reviews: {icp.max_reviews}</Badge>}
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)}>Looks right</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 3 && icp && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Choose one data source</p>
            <p className="text-sm text-muted">Each search runs against a single source — pick the one that fits this ICP.</p>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="scrape-source" checked={source === 'google_places'} onChange={() => setSource('google_places')} disabled={!placesConfigured} className="h-4 w-4 accent-violet-500" />
              Google Places {!placesConfigured && <span className="text-xs text-muted">(no key configured — see Settings)</span>}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="scrape-source" checked={source === 'companies_house'} onChange={() => setSource('companies_house')} disabled={icp.country !== 'GB' || !chConfigured} className="h-4 w-4 accent-violet-500" />
              Companies House {icp.country !== 'GB' && <span className="text-xs text-muted">(UK only)</span>}
              {icp.country === 'GB' && !chConfigured && <span className="text-xs text-muted">(no key configured — see Settings)</span>}
            </label>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => setStep(4)} disabled={sourceUnavailable}>Continue</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Ready to search {source === 'google_places' ? 'Google Places' : 'Companies House'}</p>
            <p className="text-sm text-muted">This runs in the background — you'll be taken to a live results page.</p>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(3)}>Back</Button>
              <Button onClick={() => void runScrape()} disabled={busy}>{busy ? 'Starting…' : 'Find leads'}</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Scraper.tsx
git commit -m "feat: lead scraper ICP wizard (/scraper)"
```

---

### Task 10: UI — Review table (`/scraper/jobs/:id`) + routing

**Files:**
- Create: `src/pages/ScraperJob.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useScrapeJob` + `useRawLeadActions` (Task 8), `toCsv` (`src/lib/csv.ts`), `Scraper`
  (Task 9).
- Produces: nothing further downstream — this is the last piece of the cycle.

- [ ] **Step 1: Write the review table**

```tsx
// src/pages/ScraperJob.tsx
import { useState } from 'react';
import { useParams } from 'react-router';
import { CheckCircle2, XCircle, SkipForward, Sparkles, Mail } from 'lucide-react';
import { useScrapeJob } from '../hooks/useScrapeJob';
import { useRawLeadActions } from '../hooks/useRawLeadActions';
import { useOrgApiSettings } from '../hooks/useOrgApiSettings';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { toCsv } from '../lib/csv';
import type { RawLead } from '../types';

function statusBadge(job: { status: string } | null) {
  if (!job) return null;
  const classes: Record<string, string> = {
    pending: 'bg-slate-500/15 text-slate-300',
    running: 'bg-cyan/15 text-cyan',
    completed: 'bg-emerald-500/15 text-emerald-400',
    failed: 'bg-red-500/15 text-red-400',
  };
  return <Badge className={classes[job.status] ?? classes.pending}>{job.status}</Badge>;
}

/** Scrape-job results review table (SPEC.md §5 "Approval Flow"). */
export function ScraperJob() {
  const { id } = useParams<{ id: string }>();
  const { job, rawLeads, loading, refresh } = useScrapeJob(id!);
  const { approve, reject, skip, enrichWithApollo, enrichWithHunter } = useRawLeadActions();
  const { settings } = useOrgApiSettings();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);

  const apolloConfigured = settings.find((s) => s.provider === 'apollo')?.is_configured ?? false;
  const hunterConfigured = settings.find((s) => s.provider === 'hunter')?.is_configured ?? false;

  async function runAction(lead: RawLead, fn: (l: RawLead) => Promise<string | null>) {
    setBusyId(lead.id); setRowError(null);
    const err = await fn(lead);
    setBusyId(null);
    if (err) setRowError({ id: lead.id, text: err });
    else void refresh();
  }

  function exportCsv() {
    const headers = ['Business', 'Phone', 'Email', 'City', 'Rating', 'Reviews', 'Source', 'Status'];
    const rows = rawLeads.map((l) => [
      l.business_name, l.phone ?? '', l.email ?? '', l.city ?? '',
      l.google_rating?.toString() ?? '', l.review_count?.toString() ?? '', l.source, l.status,
    ]);
    const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `scrape-job-${id}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!job) return <p role="alert" className="text-sm text-red-400">Job not found.</p>;

  const pending = rawLeads.filter((l) => l.status === 'pending' || l.status === 'duplicate');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] font-extrabold">Scrape results</h1>
          {statusBadge(job)}
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={rawLeads.length === 0}>Download CSV</Button>
      </header>
      {job.status === 'failed' && <p role="alert" className="text-sm text-red-400">{job.error_message}</p>}
      {job.status !== 'completed' && job.status !== 'failed' && (
        <p className="text-sm text-muted">{job.results_count} found so far — still running…</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="p-3">Business</th>
              <th className="p-3">Phone</th>
              <th className="p-3">Email</th>
              <th className="p-3">Rating</th>
              <th className="p-3">City</th>
              <th className="p-3">Source</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((lead) => (
              <tr key={lead.id} className={`border-b border-line ${lead.status === 'duplicate' ? 'bg-amber-500/10' : ''}`}>
                <td className="p-3 font-semibold">
                  {lead.business_name}
                  {lead.status === 'duplicate' && <Badge className="ml-2 bg-amber-500/20 text-amber-400">Possible duplicate</Badge>}
                </td>
                <td className="p-3">{lead.phone ?? '—'}</td>
                <td className="p-3">{lead.email ?? '—'}</td>
                <td className="p-3">{lead.google_rating ? `${lead.google_rating} (${lead.review_count ?? 0})` : '—'}</td>
                <td className="p-3">{lead.city ?? '—'}</td>
                <td className="p-3">{lead.source}</td>
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" onClick={() => void runAction(lead, approve)} disabled={busyId === lead.id} title="Approve">
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button variant="danger" onClick={() => void runAction(lead, reject)} disabled={busyId === lead.id} title="Reject">
                      <XCircle className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button variant="ghost" onClick={() => void runAction(lead, skip)} disabled={busyId === lead.id} title="Skip">
                      <SkipForward className="h-4 w-4" aria-hidden />
                    </Button>
                    {apolloConfigured && lead.website && (
                      <Button variant="ghost" onClick={() => void runAction(lead, enrichWithApollo)} disabled={busyId === lead.id} title="Enrich with Apollo — uses 1 Apollo credit">
                        <Sparkles className="h-4 w-4" aria-hidden />
                      </Button>
                    )}
                    {hunterConfigured && lead.website && !lead.email && (
                      <Button variant="ghost" onClick={() => void runAction(lead, enrichWithHunter)} disabled={busyId === lead.id} title="Find email with Hunter — uses 1 Hunter credit">
                        <Mail className="h-4 w-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                  {rowError?.id === lead.id && <p role="alert" className="mt-1 text-xs text-red-400">{rowError.text}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pending.length === 0 && rawLeads.length > 0 && (
          <p className="p-6 text-center text-sm text-muted">All results have been reviewed.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire routing in `src/App.tsx`**

Replace:
```tsx
              <Route path="/scraper/*" element={<ComingSoon module="Lead Scraper" />} />
```
with:
```tsx
              <Route path="/scraper" element={<Scraper />} />
              <Route path="/scraper/jobs/:id" element={<ScraperJob />} />
```
And add the two imports near the other page imports:
```tsx
import { Scraper } from './pages/Scraper';
import { ScraperJob } from './pages/ScraperJob';
```
`ComingSoon`'s import stays — it's still used by the `/analytics` and catch-all routes.

- [ ] **Step 3: Typecheck and test**

```bash
npx tsc --noEmit && npx vitest run
```
Expected: clean, 48/48 (no new unit tests — this task is UI + routing, matching the repo's
existing convention of live-verifying pages rather than unit-testing them).

- [ ] **Step 4: Full end-to-end browser verification**

With the dev server running (`npm run dev`), signed in as Kevin with DI Dreamlabs selected:
1. Navigate to `/scraper`. Confirm the wizard renders, Google Places is checked/enabled (DI
   Dreamlabs has the global fallback).
2. Enter a real ICP (e.g. "AI automation agencies in Austin, Texas, fewer than 50 reviews"),
   confirm Step 2 shows parsed params with `country` implying US, confirm the Companies House
   checkbox is disabled with the "(UK only)" note in Step 3.
3. Run the scrape. Confirm you land on `/scraper/jobs/:id` immediately (no long wait for the HTTP
   response) and watch the status badge move `pending`→`running`→`completed` live without a
   manual refresh.
4. Confirm results render with phone/rating/city populated, approve one, confirm it appears in
   `/pipeline/list` with the correct `org_id` (check via SQL: `select org_id from leads where
   business_name = '<the one you approved>';`) and `raw_lead_id` correctly set.
5. Reject one, confirm it disappears from the pending view.
6. Download the CSV, confirm it opens and contains the expected columns.
7. Repeat steps 1-3 for Mr Brush & Co with a UK ICP (e.g. "commercial cleaning companies in
   Manchester"), confirm the Companies House checkbox is enabled and, if checked, that checkbox's
   flow also completes correctly end to end.
8. If you have a real (even free-tier-adjacent) Apollo or Hunter key handy, configure it via
   `/settings/organization` and confirm its button appears on a row with a website and functions
   correctly; if not, confirm the buttons correctly stay hidden when unconfigured.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ScraperJob.tsx src/App.tsx
git commit -m "feat: scrape-job review table + wire scraper routes"
```

---

## Self-Review Notes (applied)

- **Spec coverage:** every `SPEC.md` §5 element has a task — ICP wizard (Task 9), AI parse
  (Task 4), source picker with CH auto-disable (Task 9 Step 3), scrape trigger + live progress
  (Tasks 5/6/9/10), review table with Approve/Reject/Skip + duplicate flagging + CSV export
  (Task 10). Design-doc additions (Apollo/Hunter, org-scoping, 150s ceiling) covered in Tasks
  1/2/7/10. Bulk approve/reject-all from `SPEC.md`'s "Bulk actions" line is the one explicit
  design-doc simplification NOT included — flagging it here since it's real spec text this plan
  doesn't implement; add as a fast-follow if Kevin wants it (small addition to Task 10's table:
  row selection + two buttons that just loop `approve`/`reject` over the selected set).
- **Type consistency:** `IcpParams`/`ScrapeJob`/`RawLead` (Task 3) are the single source of truth,
  referenced identically (not redefined) by Tasks 4/5/6/8/9/10 — Tasks 5/6's edge functions
  redeclare a same-shaped local `IcpParams` interface rather than importing Task 3's, since edge
  functions (Deno) can't import from `src/types/` across the Supabase Functions bundle boundary
  (no existing edge function does this — confirmed convention). Function/hook names used
  consistently: `useScrapeJob`, `useRawLeadActions`, `approve`/`reject`/`skip`/`enrichWithApollo`/
  `enrichWithHunter`, matching between Task 8's definition and Task 10's consumption.
- **Placeholder scan:** no TBD/TODO — every step has real, complete code.
