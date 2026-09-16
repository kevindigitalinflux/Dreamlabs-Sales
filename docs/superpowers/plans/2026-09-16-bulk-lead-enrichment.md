# Bulk Lead Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user multi-select leads on the Pipeline list, run a free-first
enrichment waterfall (website scrape → Companies House → OpenCorporates →
Apollo/Hunter as a last, opt-in resort) to fill missing email/phone/owner
name, review every found value as a from→to diff, and apply only what they
keep checked.

**Architecture:** One new edge function (`enrich-leads-bulk`) orchestrates a
bounded-concurrency lookup waterfall across several new/promoted shared Deno
helpers and returns proposed changes — it never writes to `leads` itself.
The frontend adds multi-select to the existing Pipeline list table (mirroring
`ScraperJob.tsx`'s proven checkbox pattern), a review modal, and applies
accepted changes through the existing `useLeads().updateLead()` path.

**Tech Stack:** Supabase Edge Functions (Deno), React 18 + TypeScript,
Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-bulk-lead-enrichment-design.md`

## Global Constraints

- Free-first ordering, always: website scrape → Companies House (UK) →
  OpenCorporates (non-UK best-effort) → Apollo/Hunter, and Apollo/Hunter are
  only ever tried for a field still blank after the free sources.
- Every provider lookup catches its own errors and returns `null` on failure
  — one bad lookup, exhausted quota, or missing key must never fail the
  batch or another lead in it.
- `enrich-leads-bulk` is read-only against `leads` — it returns proposed
  changes; nothing is written until the user applies them from the review
  panel.
- Bulk batches are capped at 40 leads (`MAX_LEADS = 40` in the edge
  function).
- Never trust a client-supplied `org_id` — every edge function in this plan
  derives org membership from the rows it's given and verifies it
  server-side, matching `enrich-apollo`/`enrich-hunter`'s existing pattern.
- **Edge function deploy layout is per-function and must be preserved.**
  Before redeploying any existing function (`scrape-google-places`,
  `scrape-companies-house`, `org-api-settings`), call
  `mcp__plugin_supabase_supabase__get_edge_function` first to see its
  CURRENT stored file layout and reproduce it exactly — different functions
  in this project use different conventions (`functions/<name>/index.ts` +
  `functions/_shared/`, vs `<name>/index.ts` + `_shared/` siblings, vs
  `source/index.ts` + `_shared/`). Guessing the layout breaks import paths.
- Supabase project id for all MCP deploy/execute_sql calls:
  `wgomksxelyfkzepbnkdd`.
- This codebase has no Deno-side unit test harness — Deno/edge-function
  logic (including pure helpers that only exist under
  `supabase/functions/_shared/`, like `isFuzzyNameMatch`) is verified by
  deploying and invoking it for real (via the Supabase MCP tools or a direct
  `supabase.functions.invoke` from the browser), not by writing `.test.ts`
  files under `supabase/functions/`. Frontend component/page behavior is
  verified live in the browser (Chrome MCP tools are available to you), not
  via React component tests — this repo has none and none should be added.
  The one case that DOES get a real Vitest test is logic that lives under
  `src/lib/` because a browser-side (React) consumer genuinely imports it —
  this plan's `src/lib/enrichmentGrouping.ts` (Task 6) is that case, matching
  this repo's existing `src/lib/templateVars.ts`/`.test.ts` precedent. Don't
  create a `src/lib/` twin of a Deno-only helper just to get it a test —
  `_shared/domain.ts`'s `bareDomain` is the existing precedent for "pure,
  untested, Deno-only, verified live."

---

### Task 1: Free website contact extraction (promote + extend)

**Files:**
- Create: `supabase/functions/_shared/websiteContact.ts`
- Modify: `supabase/functions/scrape-google-places/index.ts`

**Interfaces:**
- Produces: `scrapeWebsiteContact(website: string | null | undefined):
  Promise<{ email: string | null; phone: string | null }>` — consumed by
  Task 5's `enrich-leads-bulk` and, after this task, by
  `scrape-google-places` itself.

- [ ] **Step 1: Create the shared helper**

`supabase/functions/_shared/websiteContact.ts`:

```typescript
// supabase/functions/_shared/websiteContact.ts

// Asset/image extensions that commonly appear as the "TLD" portion of a
// false-positive plain-text email match (e.g. `logo@2x.png` in a srcset).
const NON_EMAIL_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico']);

function extractEmail(html: string): string | null {
  const mailto = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (mailto) return mailto[1];
  const plain = html.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.([a-zA-Z]{2,})\b/);
  if (!plain) return null;
  const tld = plain[1].toLowerCase();
  return NON_EMAIL_TLDS.has(tld) ? null : plain[0];
}

function extractPhone(html: string): string | null {
  const tel = html.match(/tel:([+\d][\d\s()-]{6,18}\d)/);
  if (tel) return tel[1].trim();
  // Plain-text fallback: an international-looking number — at least 8
  // digits, optionally grouped with spaces/hyphens/parens, optional leading
  // +. Bounded lookaround keeps it from matching inside a longer token like
  // a tracking id or a version string glued to letters/punctuation.
  const plain = html.match(/(?<![\w.@])(\+?\d[\d\s()-]{7,17}\d)(?![\w.@])/);
  return plain ? plain[1].trim() : null;
}

/**
 * Best-effort: fetch a business website and pull a plausible contact email
 * and phone number from it. Free — no API key. Never throws; a timeout,
 * network error, or hostile/broken site just yields nulls (one bad lookup
 * must never fail the caller's batch).
 */
export async function scrapeWebsiteContact(
  website: string | null | undefined,
): Promise<{ email: string | null; phone: string | null }> {
  if (!website) return { email: null, phone: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(website, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { email: null, phone: null };
    const html = await res.text();
    return { email: extractEmail(html), phone: extractPhone(html) };
  } catch {
    return { email: null, phone: null };
  } finally {
    // Keep the abort signal armed through the full res.text() read, not just
    // the initial fetch() resolution (which only waits for headers).
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 2: Rewire `scrape-google-places` to use it**

In `supabase/functions/scrape-google-places/index.ts`:

1. Delete the local `NON_EMAIL_TLDS` constant and the local `findEmail`
   function (lines 19–45 in the current file).
2. Add the import at the top, alongside the other `_shared` imports:
   ```typescript
   import { scrapeWebsiteContact } from '../_shared/websiteContact.ts';
   ```
3. In `runScrapeJob`, change the `runBounded` callback from:
   ```typescript
   const enriched = await runBounded(places, 8, async (place) => {
     const details = await fetchPlaceDetails(place.place_id, apiKey);
     const email = await findEmail(details.website ?? undefined);
     return { place, details, email };
   });
   ```
   to:
   ```typescript
   const enriched = await runBounded(places, 8, async (place) => {
     const details = await fetchPlaceDetails(place.place_id, apiKey);
     const { email } = await scrapeWebsiteContact(details.website);
     return { place, details, email };
   });
   ```
   Nothing else in the file changes — `email` is still the only field this
   function consumes from the helper; `phone` continues to come from Google
   Place Details as before.

- [ ] **Step 3: Deploy and live-verify no regression**

Call `mcp__plugin_supabase_supabase__get_edge_function` for
`scrape-google-places` to confirm its current file layout, then
`mcp__plugin_supabase_supabase__deploy_edge_function` with the updated
`index.ts` plus the new `_shared/websiteContact.ts` file, preserving that
exact layout (project id `wgomksxelyfkzepbnkdd`).

Invoke it for real with a small, cheap ICP against an org that already has a
configured `google_places` key (e.g. DI Dreamlabs), `max_results: 1`:

```typescript
await supabase.functions.invoke('scrape-google-places', {
  body: {
    org_id: '<DI Dreamlabs org id>',
    icp_params: { industry: 'plumber', location: null, city: 'London', country: 'GB', min_staff: null, min_rating: null, max_rating: null, max_reviews: null, keywords: [] },
    max_results: 1,
  },
});
```

Poll the returned `scrape_jobs` row (`select * from scrape_jobs where id =
'<job_id>'`) until `status = 'completed'`, then check the inserted
`raw_leads` row: confirm the job completed successfully (an `email` value is
a nice-to-have confirmation the extraction still works, but a completed job
with `email: null` is also an acceptable pass — the regression to catch is a
thrown error or a failed job, not "no email found on this particular site").

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/websiteContact.ts supabase/functions/scrape-google-places/index.ts
git commit -m "feat: promote website email/phone extraction to a shared helper"
```

---

### Task 2: Companies House officer lookup (promote + extend) + fuzzy-match guard

**Files:**
- Create: `supabase/functions/_shared/fuzzyMatch.ts`
- Create: `supabase/functions/_shared/companiesHouse.ts`
- Modify: `supabase/functions/scrape-companies-house/index.ts`

**Interfaces:**
- Produces: `isFuzzyNameMatch(a: string, b: string): boolean`;
  `normalizeOfficerName(rawName: string): string`;
  `fetchFirstOfficer(companyNumber: string, apiKey: string): Promise<string
  | null>`; `searchCompanyByName(businessName: string, apiKey: string):
  Promise<{ company_number: string; title: string } | null>`;
  `lookupCompaniesHouseOfficer(businessName: string, apiKey: string):
  Promise<string | null>` — the last is consumed by Task 5's
  `enrich-leads-bulk`. `isFuzzyNameMatch` is also consumed by Task 4's
  OpenCorporates lookup.

- [ ] **Step 1: Create the fuzzy-match guard**

`supabase/functions/_shared/fuzzyMatch.ts`:

```typescript
// supabase/functions/_shared/fuzzyMatch.ts

/**
 * Case-insensitive "close enough" name match: true if either name contains
 * the other. Used to guard against attaching a company-registry result to
 * the wrong lead when a free-text search returns an unrelated top result.
 */
export function isFuzzyNameMatch(a: string, b: string): boolean {
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (!normA || !normB) return false;
  return normA.includes(normB) || normB.includes(normA);
}
```

- [ ] **Step 2: Create the shared Companies House helper**

`supabase/functions/_shared/companiesHouse.ts` — this promotes
`normalizeOfficerName`/`fetchFirstOfficer` out of
`scrape-companies-house/index.ts` unchanged, and adds two new functions:

```typescript
// supabase/functions/_shared/companiesHouse.ts
import { isFuzzyNameMatch } from './fuzzyMatch.ts';

/**
 * Companies House returns officer names as "SURNAME, Forename Middlename".
 * Reformat to "Forename Middlename SURNAME" so downstream consumers (e.g.
 * templateVars.ts's `owner_name?.split(' ')[0]` for {{first_name}}) get a
 * real first name instead of "SURNAME," with a trailing comma. Falls back to
 * the raw value unchanged if it isn't in the comma-separated format.
 */
export function normalizeOfficerName(rawName: string): string {
  const commaIndex = rawName.indexOf(', ');
  if (commaIndex === -1) return rawName;
  const surname = rawName.slice(0, commaIndex);
  const forenames = rawName.slice(commaIndex + 2);
  return `${forenames} ${surname}`;
}

export async function fetchFirstOfficer(companyNumber: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.company-information.service.gov.uk/company/${companyNumber}/officers`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) return null;
    const data = await res.json() as { items?: { name?: string }[] };
    const rawName = data.items?.[0]?.name;
    return rawName ? normalizeOfficerName(rawName) : null;
  } catch {
    return null;
  }
}

/**
 * Searches Companies House by free-text business name, returns the top
 * result only if it plausibly matches — guards against attaching an
 * unrelated company's officer to the wrong lead.
 */
export async function searchCompanyByName(businessName: string, apiKey: string): Promise<{ company_number: string; title: string } | null> {
  try {
    const res = await fetch(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(businessName)}&items_per_page=1`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) return null;
    const data = await res.json() as { items?: { company_number?: string; title?: string }[] };
    const top = data.items?.[0];
    if (!top?.company_number || !top.title) return null;
    if (!isFuzzyNameMatch(businessName, top.title)) return null;
    return { company_number: top.company_number, title: top.title };
  } catch {
    return null;
  }
}

/**
 * Free, UK-only owner-name lookup for an existing lead: search by business
 * name, then pull its first registered officer. Returns null on no match, no
 * officers, or any provider error — never throws.
 */
export async function lookupCompaniesHouseOfficer(businessName: string, apiKey: string): Promise<string | null> {
  const company = await searchCompanyByName(businessName, apiKey);
  if (!company) return null;
  return fetchFirstOfficer(company.company_number, apiKey);
}
```

- [ ] **Step 3: Rewire `scrape-companies-house` to import the shared copies**

In `supabase/functions/scrape-companies-house/index.ts`:

1. Delete the local `normalizeOfficerName` and `fetchFirstOfficer`
   functions (lines 18–45 in the current file).
2. Add the import at the top:
   ```typescript
   import { fetchFirstOfficer } from '../_shared/companiesHouse.ts';
   ```
3. Leave every call site unchanged — `runScrapeJob`'s
   `const owners = await runBounded(companies, 5, (c) =>
   fetchFirstOfficer(c.company_number, apiKey));` now resolves to the
   imported function and behaves identically.

- [ ] **Step 4: Deploy and live-verify no regression**

Check `scrape-companies-house`'s current layout via `get_edge_function`,
then deploy the updated `index.ts` plus the two new `_shared/` files via
`deploy_edge_function`, preserving that layout.

Invoke it for real against an org with a configured `companies_house` key,
a UK ICP, small cap:

```typescript
await supabase.functions.invoke('scrape-companies-house', {
  body: {
    org_id: '<org id with a companies_house key configured>',
    icp_params: { industry: 'plumber', location: null, city: 'London', country: 'GB', keywords: [] },
    max_results: 3,
  },
});
```

Poll the resulting `scrape_jobs` row to `status = 'completed'`, then check
the inserted `raw_leads` rows: confirm the job completes and at least one row
has a non-null `owner_name` (this is the pre-existing behavior being
preserved, not new behavior — a regression here means the refactor broke
something).

The two NEW functions (`searchCompanyByName`, `lookupCompaniesHouseOfficer`)
are not wired into any deployed function yet — their first live exercise is
Task 5's end-to-end test of `enrich-leads-bulk`. Nothing further to verify
for them here.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/fuzzyMatch.ts supabase/functions/_shared/companiesHouse.ts supabase/functions/scrape-companies-house/index.ts
git commit -m "feat: promote Companies House officer lookup to a shared helper, add name search"
```

---

### Task 3: OpenCorporates as a new org API provider

**Files:**
- Create: `supabase/migrations/026_opencorporates_provider.sql`
- Modify: `supabase/functions/_shared/orgApiKeys.ts`
- Modify: `supabase/functions/org-api-settings/index.ts`
- Modify: `src/hooks/useOrgApiSettings.ts`
- Modify: `src/pages/OrganizationSettings.tsx`

**Interfaces:**
- Produces: `'opencorporates'` as a valid value everywhere `ApiProvider` /
  `OrgApiSetting['provider']` is used — consumed by Task 4 (the lookup
  itself) and Task 5 (`resolveOrgApiKey(service, orgId, 'opencorporates')`).

- [ ] **Step 1: Widen the provider CHECK constraint**

`supabase/migrations/026_opencorporates_provider.sql`:

```sql
-- Widen org_api_settings.provider to accept 'opencorporates' (free-tier
-- company-officer lookup for bulk lead enrichment outside the UK).
ALTER TABLE org_api_settings DROP CONSTRAINT org_api_settings_provider_check;
ALTER TABLE org_api_settings ADD CONSTRAINT org_api_settings_provider_check
  CHECK (provider = ANY (ARRAY['gemini','google_places','companies_house','apollo','hunter','anthropic','opencorporates']));
```

Apply it with `mcp__plugin_supabase_supabase__apply_migration` (project id
`wgomksxelyfkzepbnkdd`, name `opencorporates_provider`).

- [ ] **Step 2: Add the provider to `_shared/orgApiKeys.ts`**

In `supabase/functions/_shared/orgApiKeys.ts`, change:

```typescript
export type ApiProvider = 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter' | 'anthropic';

const GLOBAL_ENV_VARS: Record<ApiProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  google_places: 'GOOGLE_PLACES_API_KEY',
  companies_house: 'COMPANIES_HOUSE_API_KEY',
  apollo: 'APOLLO_API_KEY',
  hunter: 'HUNTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};
```

to:

```typescript
export type ApiProvider = 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter' | 'anthropic' | 'opencorporates';

const GLOBAL_ENV_VARS: Record<ApiProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  google_places: 'GOOGLE_PLACES_API_KEY',
  companies_house: 'COMPANIES_HOUSE_API_KEY',
  apollo: 'APOLLO_API_KEY',
  hunter: 'HUNTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  // Free-tier provider, same fallback tier as companies_house/gemini/places
  // — Kevin's own 2 orgs can use a shared key here if one is ever
  // configured (unlike apollo/hunter, which never fall back for anyone).
  opencorporates: 'OPENCORPORATES_API_KEY',
};
```

(The rest of the file — `resolveOrgApiKey`'s body — is unchanged; it already
works generically over `ApiProvider`.)

- [ ] **Step 3: Add validation in `org-api-settings`**

In `supabase/functions/org-api-settings/index.ts`:

1. Change the `Provider` type:
   ```typescript
   type Provider = 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter' | 'anthropic' | 'opencorporates';
   ```
2. In `validateKey`, insert a new branch before the final unconditional
   Hunter fallback (the function currently ends with `// hunter — ...` and a
   bare `const res = ...` with no `if` guarding it — that stays the final
   `else`-equivalent branch; add opencorporates just above it):
   ```typescript
   if (provider === 'opencorporates') {
     const res = await fetch(`https://api.opencorporates.com/v0.4/companies/search?q=test&api_token=${key}`);
     return res.ok ? null : `OpenCorporates rejected the key (HTTP ${res.status})`;
   }
   // hunter — /v2/account is Hunter's free account-info call, used purely to verify the key.
   const res = await fetch(`https://api.hunter.io/v2/account?api_key=${key}`);
   return res.ok ? null : `Hunter rejected the key (HTTP ${res.status})`;
   ```
3. In the `'save'` action handler, widen the whitelist:
   ```typescript
   if (!['gemini', 'google_places', 'companies_house', 'apollo', 'hunter', 'anthropic', 'opencorporates'].includes(provider)) return json({ error: 'Invalid provider' }, 400, headers);
   ```

- [ ] **Step 4: Deploy and live-verify key validation**

Check `org-api-settings`'s current layout via `get_edge_function`, deploy
the updated file preserving it. Sign up for a free OpenCorporates API key at
`https://opencorporates.com/api_accounts/new` (or use one already on hand),
then invoke the function directly to confirm both directions:

```typescript
// Expect { error: "OpenCorporates rejected the key..." }
await supabase.functions.invoke('org-api-settings', { body: { action: 'save', org_id: '<org id>', provider: 'opencorporates', api_key: 'not-a-real-key' } });

// Expect { ok: true }
await supabase.functions.invoke('org-api-settings', { body: { action: 'save', org_id: '<org id>', provider: 'opencorporates', api_key: '<real key>' } });
```

- [ ] **Step 5: Add the provider to the frontend type and Settings UI**

In `src/hooks/useOrgApiSettings.ts`, change:
```typescript
export interface OrgApiSetting {
  provider: 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter' | 'anthropic';
  is_configured: boolean;
}
```
to:
```typescript
export interface OrgApiSetting {
  provider: 'gemini' | 'google_places' | 'companies_house' | 'apollo' | 'hunter' | 'anthropic' | 'opencorporates';
  is_configured: boolean;
}
```

In `src/pages/OrganizationSettings.tsx`, add a new entry to the `PROVIDERS`
array (after the `companies_house` entry, before `apollo`):

```typescript
  {
    key: 'opencorporates',
    label: 'OpenCorporates (owner lookup outside the UK)',
    url: 'https://opencorporates.com/api_accounts/new',
    ctaLabel: 'Get your free OpenCorporates API key →',
    freeText: "Free tier — capped at 200 requests/month and 50/day, registration required. Optional: Companies House alone already covers UK companies for the bulk enrichment feature; this extends owner-name lookup to other countries on a best-effort basis (coverage varies a lot by jurisdiction).",
  },
```

- [ ] **Step 6: Live-verify the Settings UI**

Start the local dev server if not already running (`npm run dev`), navigate
to `/settings/organization` in the browser, confirm the new "OpenCorporates"
row renders with its guide text, paste a real key into the field, click
Save, confirm it shows "Key verified and saved." and the row gets the
"Configured" badge.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/026_opencorporates_provider.sql supabase/functions/_shared/orgApiKeys.ts supabase/functions/org-api-settings/index.ts src/hooks/useOrgApiSettings.ts src/pages/OrganizationSettings.tsx
git commit -m "feat: add OpenCorporates as a free-tier org API provider"
```

---

### Task 4: OpenCorporates officer lookup

**Files:**
- Create: `supabase/functions/_shared/openCorporates.ts`

**Interfaces:**
- Consumes: `isFuzzyNameMatch` from `_shared/fuzzyMatch.ts` (Task 2).
- Produces: `lookupOpenCorporatesOfficer(businessName: string, apiKey:
  string): Promise<string | null>` — consumed by Task 5's
  `enrich-leads-bulk`.

- [ ] **Step 1: Create the helper**

`supabase/functions/_shared/openCorporates.ts`:

```typescript
// supabase/functions/_shared/openCorporates.ts
import { isFuzzyNameMatch } from './fuzzyMatch.ts';

interface OpenCorporatesCompany { name?: string; jurisdiction_code?: string; company_number?: string }
interface OpenCorporatesOfficer { name?: string }

/**
 * Free-tier (200/month, 50/day on the default plan), non-UK-focused
 * best-effort owner-name lookup — the OpenCorporates counterpart to
 * lookupCompaniesHouseOfficer for jurisdictions outside the UK. Coverage
 * varies by country depending on what that jurisdiction's registry has fed
 * into OpenCorporates; a null return is an expected, non-error outcome, not
 * a failure.
 */
export async function lookupOpenCorporatesOfficer(businessName: string, apiKey: string): Promise<string | null> {
  try {
    const searchRes = await fetch(`https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(businessName)}&api_token=${apiKey}`);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json() as { results?: { companies?: { company: OpenCorporatesCompany }[] } };
    const top = searchData.results?.companies?.[0]?.company;
    if (!top?.name || !top.jurisdiction_code || !top.company_number) return null;
    if (!isFuzzyNameMatch(businessName, top.name)) return null;

    const detailRes = await fetch(`https://api.opencorporates.com/v0.4/companies/${top.jurisdiction_code}/${top.company_number}?api_token=${apiKey}`);
    if (!detailRes.ok) return null;
    const detailData = await detailRes.json() as { results?: { company?: { officers?: { officer: OpenCorporatesOfficer }[] } } };
    const officer = detailData.results?.company?.officers?.[0]?.officer;
    return officer?.name ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Live-verify against the real API and fix the response shape if needed**

This is a third-party API whose exact JSON envelope wasn't hand-verified
against a live call while writing this plan — the shape above
(`results.companies[].company`, `results.company.officers[].officer`)
matches OpenCorporates' documented conventions, but confirm it for real
before moving on. Using the key saved in Task 3, run this directly (e.g. in
a scratch Deno/Node script, or via `curl`):

```
curl "https://api.opencorporates.com/v0.4/companies/search?q=Tesco&api_token=<key>"
curl "https://api.opencorporates.com/v0.4/companies/gb/00445790?api_token=<key>"
```

Compare the real response against the field paths used in Step 1
(`results.companies[0].company.name` /
`.jurisdiction_code`/`.company_number`, and
`results.company.officers[0].officer.name`). If any path doesn't match,
correct `openCorporates.ts` to the real shape before continuing — do not
deploy code parsing a guessed shape without checking it against a live
response first.

- [ ] **Step 3: Deploy for real by exercising it inside `enrich-leads-bulk`**

This file isn't independently deployable (it's a shared helper); its first
real invocation happens as part of Task 5's end-to-end test. Nothing further
to verify here beyond Step 2's shape check.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/openCorporates.ts
git commit -m "feat: add OpenCorporates officer lookup for non-UK bulk enrichment"
```

---

### Task 5: `enrich-leads-bulk` edge function

**Files:**
- Create: `supabase/functions/_shared/apolloHunterLookup.ts`
- Create: `supabase/functions/enrich-leads-bulk/index.ts`
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: `scrapeWebsiteContact` (Task 1), `lookupCompaniesHouseOfficer`
  (Task 2), `lookupOpenCorporatesOfficer` (Task 4), `resolveOrgApiKey` with
  the widened `ApiProvider` (Task 3), `runBounded` (existing
  `_shared/concurrency.ts`), `bareDomain` (existing `_shared/domain.ts`).
- Produces: the HTTP contract `POST { lead_ids: string[] } → { results:
  EnrichResult[] }` where `EnrichResult = { lead_id: string; proposed:
  Partial<Record<'email'|'phone'|'owner_name', string>>; source:
  Partial<Record<'email'|'phone'|'owner_name', string>> }`, and the matching
  frontend type `EnrichmentResult`/`EnrichableField` in `src/types/index.ts`
  — both consumed by Task 8's `useLeadEnrichment` hook and
  `EnrichmentReview` component.

- [ ] **Step 1: Add read-only Apollo/Hunter lookup wrappers**

The existing `enrich-apollo`/`enrich-hunter` functions operate on
`raw_leads` and write their results to the database — this feature needs
read-only equivalents that operate on a website/domain and just return a
value, for use inside the bulk waterfall.

`supabase/functions/_shared/apolloHunterLookup.ts`:

```typescript
// supabase/functions/_shared/apolloHunterLookup.ts
import { bareDomain } from './domain.ts';

/**
 * Apollo org-enrich by domain — company-level phone only (Apollo's people
 * search, which could get a true personal phone, needs a person's name to
 * search by, which these leads often don't have; company phone is what's
 * realistically available here). Returns null on no match or any error;
 * never throws, never writes anywhere — this is a read-only lookup for
 * bulk enrichment's review-before-apply flow.
 */
export async function lookupApolloPhone(website: string | null, apiKey: string): Promise<string | null> {
  const domain = bareDomain(website ?? '');
  if (!domain) return null;
  try {
    const res = await fetch(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json() as { organization?: { primary_phone?: { number?: string } } };
    return data.organization?.primary_phone?.number ?? null;
  } catch {
    return null;
  }
}

/**
 * Hunter domain-search — highest-confidence email for the domain. Returns
 * null on no match or any error; never throws, never writes anywhere.
 */
export async function lookupHunterEmail(website: string | null, apiKey: string): Promise<string | null> {
  const domain = bareDomain(website ?? '');
  if (!domain) return null;
  try {
    const res = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`);
    if (!res.ok) return null;
    const data = await res.json() as { data?: { emails?: { value: string; confidence: number }[] } };
    const emails = data.data?.emails ?? [];
    if (emails.length === 0) return null;
    return [...emails].sort((a, b) => b.confidence - a.confidence)[0]!.value;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add the frontend types**

In `src/types/index.ts`, add (near the `Lead` interface):

```typescript
export type EnrichableField = 'email' | 'phone' | 'owner_name';

export interface EnrichmentResult {
  lead_id: string;
  proposed: Partial<Record<EnrichableField, string>>;
  source: Partial<Record<EnrichableField, string>>;
}
```

- [ ] **Step 3: Write the edge function**

`supabase/functions/enrich-leads-bulk/index.ts`:

```typescript
// supabase/functions/enrich-leads-bulk/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { runBounded } from '../_shared/concurrency.ts';
import { scrapeWebsiteContact } from '../_shared/websiteContact.ts';
import { lookupCompaniesHouseOfficer } from '../_shared/companiesHouse.ts';
import { lookupOpenCorporatesOfficer } from '../_shared/openCorporates.ts';
import { lookupApolloPhone, lookupHunterEmail } from '../_shared/apolloHunterLookup.ts';

const MAX_LEADS = 40;

interface LeadRow {
  id: string; org_id: string; business_name: string;
  website: string | null; email: string | null; phone: string | null; owner_name: string | null;
}

type Field = 'email' | 'phone' | 'owner_name';

interface EnrichResult {
  lead_id: string;
  proposed: Partial<Record<Field, string>>;
  source: Partial<Record<Field, string>>;
}

async function enrichOneLead(
  lead: LeadRow,
  keys: { companiesHouse: string | null; openCorporates: string | null; apollo: string | null; hunter: string | null },
): Promise<EnrichResult | null> {
  const proposed: Partial<Record<Field, string>> = {};
  const source: Partial<Record<Field, string>> = {};

  // 1. Website scrape — free, no key required.
  const { email: siteEmail, phone: sitePhone } = await scrapeWebsiteContact(lead.website);
  if (siteEmail && siteEmail !== lead.email) { proposed.email = siteEmail; source.email = 'website'; }
  if (sitePhone && sitePhone !== lead.phone) { proposed.phone = sitePhone; source.phone = 'website'; }

  // 2. Companies House (UK) — free registration.
  if (keys.companiesHouse) {
    const officer = await lookupCompaniesHouseOfficer(lead.business_name, keys.companiesHouse);
    if (officer && officer !== lead.owner_name) { proposed.owner_name = officer; source.owner_name = 'companies_house'; }
  }

  // 3. OpenCorporates (non-UK best-effort) — only if Companies House found nothing.
  if (!proposed.owner_name && keys.openCorporates) {
    const officer = await lookupOpenCorporatesOfficer(lead.business_name, keys.openCorporates);
    if (officer && officer !== lead.owner_name) { proposed.owner_name = officer; source.owner_name = 'opencorporates'; }
  }

  // 4. Apollo/Hunter — paid, opt-in, only for fields still blank after 1–3.
  if (!proposed.email && keys.hunter && lead.website) {
    const email = await lookupHunterEmail(lead.website, keys.hunter);
    if (email && email !== lead.email) { proposed.email = email; source.email = 'hunter'; }
  }
  if (!proposed.phone && keys.apollo && lead.website) {
    const phone = await lookupApolloPhone(lead.website, keys.apollo);
    if (phone && phone !== lead.phone) { proposed.phone = phone; source.phone = 'apollo'; }
  }

  if (Object.keys(proposed).length === 0) return null;
  return { lead_id: lead.id, proposed, source };
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

  const body = (await req.json()) as { lead_ids?: string[] };
  const leadIds = Array.isArray(body.lead_ids) ? body.lead_ids.map(String) : [];
  if (leadIds.length === 0) return json({ error: 'lead_ids is required' }, 400, headers);
  if (leadIds.length > MAX_LEADS) return json({ error: `Select ${MAX_LEADS} or fewer leads at once` }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: leads, error: leadsErr } = await service
    .from('leads').select('id, org_id, business_name, website, email, phone, owner_name').in('id', leadIds);
  if (leadsErr) return json({ error: leadsErr.message }, 500, headers);
  const resolvedLeads = (leads ?? []) as LeadRow[];
  if (resolvedLeads.length === 0) return json({ results: [] }, 200, headers);

  // Every requested lead must belong to the same org, and the caller must be
  // a member of it — never trust a client-supplied org_id, derive it from
  // the leads themselves (same discipline as enrich-apollo/enrich-hunter).
  const orgIds = new Set(resolvedLeads.map((l) => l.org_id));
  if (orgIds.size > 1) return json({ error: 'Selected leads span more than one organization' }, 400, headers);
  const orgId = [...orgIds][0]!;
  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const [companiesHouse, openCorporates, apollo, hunter] = await Promise.all([
    resolveOrgApiKey(service, orgId, 'companies_house'),
    resolveOrgApiKey(service, orgId, 'opencorporates'),
    resolveOrgApiKey(service, orgId, 'apollo'),
    resolveOrgApiKey(service, orgId, 'hunter'),
  ]);
  const keys = { companiesHouse, openCorporates, apollo, hunter };

  const enriched = await runBounded(resolvedLeads, 5, (lead) => enrichOneLead(lead, keys));
  const results = enriched.filter((r): r is EnrichResult => r !== null);

  return json({ results }, 200, headers);
});
```

- [ ] **Step 4: Deploy and live-verify end-to-end**

`enrich-leads-bulk` is a brand-new function — check whether
`get_edge_function` finds an existing entry (it shouldn't); deploy it fresh
via `deploy_edge_function` with the layout
`enrich-leads-bulk/index.ts` + the `_shared/*.ts` files it imports (matching
the flat `<name>/index.ts` + `_shared/` siblings convention already used by
`scrape-companies-house` and `draft-linkedin-message`).

Pick a handful of real leads in an org with at least a `companies_house` key
configured (2–3 leads is enough): find their ids via
`select id, business_name, website, email, phone, owner_name from leads
where org_id = '<org id>' limit 3`, then invoke:

```typescript
const { data } = await supabase.functions.invoke('enrich-leads-bulk', {
  body: { lead_ids: ['<id1>', '<id2>', '<id3>'] },
});
console.log(data);
```

Confirm: the response has a `results` array; for a lead with a real website
and a blank email, `proposed.email`/`source.email` come back populated; for
a UK business that's Companies-House-searchable, `proposed.owner_name` /
`source.owner_name: 'companies_house'` comes back for a lead with no
existing `owner_name`. Also confirm the guardrails: invoke with 41 fake ids
→ expect the 400 "Select 40 or fewer" error; invoke as a user who isn't a
member of the leads' org → expect 403.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/apolloHunterLookup.ts supabase/functions/enrich-leads-bulk/index.ts src/types/index.ts
git commit -m "feat: add enrich-leads-bulk edge function"
```

---

### Task 6: Pure grouping logic for the Apply step

**Files:**
- Create: `src/lib/enrichmentGrouping.ts`
- Test: `src/lib/enrichmentGrouping.test.ts`

**Interfaces:**
- Consumes: `EnrichmentResult`, `EnrichableField` from `src/types/index.ts`
  (Task 5).
- Produces: `groupChangesByLead(results: EnrichmentResult[], checked:
  Record<string, Set<EnrichableField>>): Record<string,
  Partial<Record<EnrichableField, string>>>` — consumed by Task 8's
  `EnrichmentReview` component.

- [ ] **Step 1: Write the failing test**

`src/lib/enrichmentGrouping.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { groupChangesByLead } from './enrichmentGrouping';
import type { EnrichableField, EnrichmentResult } from '../types';

function makeResult(overrides: Partial<EnrichmentResult>): EnrichmentResult {
  return {
    lead_id: 'lead-1',
    proposed: { email: 'new@example.com' },
    source: { email: 'website' },
    ...overrides,
  };
}

describe('groupChangesByLead', () => {
  it('includes only checked fields for a lead', () => {
    const results = [makeResult({ lead_id: 'lead-1', proposed: { email: 'a@x.com', phone: '+44 20 1111 1111' } })];
    const checked = { 'lead-1': new Set<EnrichableField>(['email']) };
    expect(groupChangesByLead(results, checked)).toEqual({ 'lead-1': { email: 'a@x.com' } });
  });

  it('omits a lead entirely when nothing is checked', () => {
    const results = [makeResult({ lead_id: 'lead-1' })];
    expect(groupChangesByLead(results, {})).toEqual({});
  });

  it('groups multiple leads independently', () => {
    const results = [
      makeResult({ lead_id: 'lead-1', proposed: { email: 'a@x.com' } }),
      makeResult({ lead_id: 'lead-2', proposed: { owner_name: 'Jane Smith' } }),
    ];
    const checked = {
      'lead-1': new Set<EnrichableField>(['email']),
      'lead-2': new Set<EnrichableField>(['owner_name']),
    };
    expect(groupChangesByLead(results, checked)).toEqual({
      'lead-1': { email: 'a@x.com' },
      'lead-2': { owner_name: 'Jane Smith' },
    });
  });

  it('skips a checked field the result did not actually propose', () => {
    const results = [makeResult({ lead_id: 'lead-1', proposed: { email: 'a@x.com' } })];
    const checked = { 'lead-1': new Set<EnrichableField>(['email', 'phone']) };
    expect(groupChangesByLead(results, checked)).toEqual({ 'lead-1': { email: 'a@x.com' } });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/lib/enrichmentGrouping.test.ts`
Expected: FAIL — `enrichmentGrouping.ts` doesn't exist yet (`Cannot find
module './enrichmentGrouping'`).

- [ ] **Step 3: Implement**

`src/lib/enrichmentGrouping.ts`:

```typescript
import type { EnrichableField, EnrichmentResult } from '../types';

/**
 * Turns enrichment results + a per-lead set of checked fields into one
 * { [leadId]: patch } map, containing only the fields the user kept
 * checked. Leads with nothing checked (or nothing valid checked) are
 * omitted entirely.
 */
export function groupChangesByLead(
  results: EnrichmentResult[],
  checked: Record<string, Set<EnrichableField>>,
): Record<string, Partial<Record<EnrichableField, string>>> {
  const grouped: Record<string, Partial<Record<EnrichableField, string>>> = {};
  for (const result of results) {
    const checkedFields = checked[result.lead_id];
    if (!checkedFields || checkedFields.size === 0) continue;
    const patch: Partial<Record<EnrichableField, string>> = {};
    for (const field of checkedFields) {
      const value = result.proposed[field];
      if (value !== undefined) patch[field] = value;
    }
    if (Object.keys(patch).length > 0) grouped[result.lead_id] = patch;
  }
  return grouped;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/lib/enrichmentGrouping.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrichmentGrouping.ts src/lib/enrichmentGrouping.test.ts
git commit -m "feat: add pure grouping logic for bulk enrichment apply step"
```

---

### Task 7: Multi-select on the Pipeline list

**Files:**
- Modify: `src/components/pipeline/ListTable.tsx`
- Modify: `src/pages/PipelineList.tsx`

**Interfaces:**
- Produces: `ListTable`'s new props `selected: Set<string>`, `onToggle: (id:
  string) => void`, `onToggleAll: () => void`; `PipelineList`'s new
  `selected: Set<string>` state — consumed by Task 8's "Fill missing
  details" button and by the bulk email-drafting plan (per its spec's
  documented dependency on this task).

- [ ] **Step 1: Add checkboxes to `ListTable`**

In `src/components/pipeline/ListTable.tsx`, change the props interface:

```typescript
interface ListTableProps {
  leads: Lead[];
  profiles: Profile[];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  onOpen: (lead: Lead) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}
```

Change the function signature to destructure the three new props:

```typescript
export function ListTable({ leads, profiles, sortKey, sortDir, onSort, onOpen, selected, onToggle, onToggleAll }: ListTableProps) {
```

Add a checkbox header cell as the FIRST `<th>` in the header row:

```tsx
<th className="w-11 px-3">
  <input
    type="checkbox"
    checked={leads.length > 0 && selected.size === leads.length}
    onChange={onToggleAll}
    className="h-4 w-4 accent-violet-500"
    aria-label="Select all"
  />
</th>
```

Add a checkbox cell as the FIRST `<td>` in each row, and stop its click from
bubbling to the row's own `onClick={() => onOpen(lead)}`:

```tsx
<td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
  <input
    type="checkbox"
    checked={selected.has(lead.id)}
    onChange={() => onToggle(lead.id)}
    className="h-4 w-4 accent-violet-500"
    aria-label={`Select ${lead.business_name}`}
  />
</td>
```

- [ ] **Step 2: Rename the existing `selected` state to `openLead`**

`PipelineList.tsx` already has `const [selected, setSelected] =
useState<Lead | null>(null);` for the currently-open `LeadPanel`. This
task adds a DIFFERENT, new `selected: Set<string>` state for the checkbox
multi-select, so rename the existing one first to avoid a collision:

1. `const [selected, setSelected] = useState<Lead | null>(null);` becomes
   `const [openLead, setOpenLead] = useState<Lead | null>(null);`
2. The effect that keeps the panel's lead fresh —
   ```typescript
   useEffect(() => {
     if (selected) setSelected(leads.find((l) => l.id === selected.id) ?? null);
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [leads]);
   ```
   becomes:
   ```typescript
   useEffect(() => {
     if (openLead) setOpenLead(leads.find((l) => l.id === openLead.id) ?? null);
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [leads]);
   ```
3. `<ListTable leads={visible} profiles={profiles} sortKey={sortKey}
   sortDir={sortDir} onSort={handleSort} onOpen={setSelected} />` — the
   `onOpen={setSelected}` prop becomes `onOpen={setOpenLead}`.
4. `<LeadPanel lead={selected} profiles={profiles} onClose={() =>
   setSelected(null)} onUpdate={updateLead} />` becomes `<LeadPanel
   lead={openLead} profiles={profiles} onClose={() => setOpenLead(null)}
   onUpdate={updateLead} />`.

- [ ] **Step 3: Add the new multi-select state to `PipelineList`**

Add near the other `useState` calls:

```typescript
const [selected, setSelected] = useState<Set<string>>(new Set());
```

Add an effect clearing selection whenever the filters change (so a stale
selection can't silently include leads that are no longer visible):

```typescript
useEffect(() => {
  setSelected(new Set());
}, [filters]);
```

Add the toggle handlers, operating on `visible` (the already
filtered/sorted array this page renders) — "select all" means "all
currently shown," matching `ScraperJob.tsx`'s existing precedent:

```typescript
function toggleSelected(id: string) {
  setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
}

function toggleSelectAll() {
  setSelected((prev) => (prev.size === visible.length ? new Set() : new Set(visible.map((l) => l.id))));
}
```

Pass the three new props to `<ListTable>` (now that `onOpen` is
`setOpenLead`, there's no collision with `selected`/`onToggle`/`onToggleAll`
below):

```tsx
<ListTable
  leads={visible}
  profiles={profiles}
  sortKey={sortKey}
  sortDir={sortDir}
  onSort={handleSort}
  onOpen={setOpenLead}
  selected={selected}
  onToggle={toggleSelected}
  onToggleAll={toggleSelectAll}
/>
```

- [ ] **Step 4: Live-verify in the browser**

Start the dev server if not running (`npm run dev`), navigate to
`/pipeline` (List view — use the `ViewToggle` if it opens on Kanban),
screenshot to confirm checkboxes render in the header and every row.

Click 2–3 row checkboxes, screenshot to confirm they show checked. Click the
header "select all" checkbox, screenshot to confirm every visible row is now
checked and the header checkbox itself shows checked. Click it again,
confirm all rows clear. Change a filter (e.g. type something into search),
confirm any previously-checked rows are now unchecked (selection cleared on
filter change). Click a row's business name (not the checkbox) and confirm
the `LeadPanel` still opens correctly (proves the `openLead` rename in Step
2 didn't break the existing open-lead flow).

- [ ] **Step 5: Run the full check and commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean (0 type errors, all existing tests still passing).

```bash
git add src/components/pipeline/ListTable.tsx src/pages/PipelineList.tsx
git commit -m "feat: add multi-select to the Pipeline list table"
```

---

### Task 8: Bulk-enrich UI — hook, review modal, and wiring

**Files:**
- Create: `src/hooks/useLeadEnrichment.ts`
- Create: `src/components/pipeline/EnrichmentReview.tsx`
- Modify: `src/pages/PipelineList.tsx`

**Interfaces:**
- Consumes: `enrich-leads-bulk` (Task 5), `EnrichmentResult`/
  `EnrichableField` (Task 5), `groupChangesByLead` (Task 6), the `selected`
  multi-select state (Task 7), and the existing `useLeads().updateLead(id,
  patch: LeadPatch)`.

- [ ] **Step 1: Write the hook**

`src/hooks/useLeadEnrichment.ts`:

```typescript
import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { EnrichmentResult } from '../types';

/**
 * Runs the free-then-paid enrichment waterfall for a batch of leads. Never
 * writes to the database itself — callers apply whichever proposed changes
 * the user keeps checked via useLeads().updateLead().
 */
export function useLeadEnrichment() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runEnrichment = useCallback(async (leadIds: string[]): Promise<EnrichmentResult[]> => {
    setRunning(true);
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke('enrich-leads-bulk', {
      body: { lead_ids: leadIds },
    });
    setRunning(false);
    if (invokeErr) { setError(invokeErr.message); return []; }
    const result = data as { results?: EnrichmentResult[]; error?: string };
    if (result.error) { setError(result.error); return []; }
    return result.results ?? [];
  }, []);

  return { running, error, runEnrichment };
}
```

- [ ] **Step 2: Write the review modal**

`src/components/pipeline/EnrichmentReview.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { groupChangesByLead } from '../../lib/enrichmentGrouping';
import type { EnrichableField, EnrichmentResult, Lead } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

const FIELD_LABELS: Record<EnrichableField, string> = {
  email: 'Email', phone: 'Phone', owner_name: 'Owner',
};
const SOURCE_LABELS: Record<string, string> = {
  website: 'website', companies_house: 'Companies House', opencorporates: 'OpenCorporates',
  hunter: 'Hunter', apollo: 'Apollo',
};

interface EnrichmentReviewProps {
  open: boolean;
  results: EnrichmentResult[];
  leadsById: Record<string, Lead>;
  onClose: () => void;
  onApply: (grouped: Record<string, Partial<Record<EnrichableField, string>>>) => Promise<{ applied: number; failed: { leadId: string; error: string }[] }>;
}

/**
 * Review-before-apply diff panel for bulk enrichment — every proposed field
 * is individually checkable, checked by default; nothing writes until
 * Apply.
 */
export function EnrichmentReview({ open, results, leadsById, onClose, onApply }: EnrichmentReviewProps) {
  const [checked, setChecked] = useState<Record<string, Set<EnrichableField>>>(() => {
    const initial: Record<string, Set<EnrichableField>> = {};
    for (const r of results) initial[r.lead_id] = new Set(Object.keys(r.proposed) as EnrichableField[]);
    return initial;
  });
  const [applying, setApplying] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const changeCount = useMemo(
    () => Object.values(checked).reduce((sum, fields) => sum + fields.size, 0),
    [checked],
  );

  function toggle(leadId: string, field: EnrichableField) {
    setChecked((prev) => {
      const next = { ...prev };
      const fields = new Set(next[leadId]);
      if (fields.has(field)) fields.delete(field); else fields.add(field);
      next[leadId] = fields;
      return next;
    });
  }

  async function handleApply() {
    setApplying(true);
    const grouped = groupChangesByLead(results, checked);
    const { applied, failed } = await onApply(grouped);
    setApplying(false);
    setSummary(failed.length === 0 ? `Updated ${applied} leads` : `Updated ${applied} leads — ${failed.length} failed`);
  }

  return (
    <Modal open={open} onClose={onClose} title="Review found details">
      <div className="flex flex-col gap-4">
        {results.length === 0 && <p className="text-sm text-muted">Nothing found for the selected leads.</p>}
        {results.map((r) => {
          const lead = leadsById[r.lead_id];
          return (
            <div key={r.lead_id} className="rounded-lg border border-line p-3">
              <p className="mb-2 text-sm font-semibold">{lead?.business_name ?? r.lead_id}</p>
              <ul className="flex flex-col gap-1">
                {(Object.keys(r.proposed) as EnrichableField[]).map((field) => {
                  const from = (lead?.[field] as string | null) ?? '—';
                  const to = r.proposed[field]!;
                  const isChecked = checked[r.lead_id]?.has(field) ?? false;
                  return (
                    <li key={field} className="flex flex-wrap items-center gap-2 rounded bg-surface/60 p-2 text-sm">
                      <input type="checkbox" checked={isChecked} onChange={() => toggle(r.lead_id, field)} className="h-4 w-4 accent-violet-500" aria-label={`Apply ${field} for ${lead?.business_name ?? r.lead_id}`} />
                      <span className="w-16 text-xs font-semibold text-muted">{FIELD_LABELS[field]}</span>
                      <span className="text-muted line-through">{from}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted" aria-hidden />
                      <span className="font-semibold text-success">{to}</span>
                      <span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase text-muted">{SOURCE_LABELS[r.source[field] ?? ''] ?? r.source[field]}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {summary && <p role="status" className="text-sm text-success">{summary}</p>}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>{summary ? 'Close' : 'Cancel'}</Button>
          {!summary && (
            <Button onClick={() => void handleApply()} disabled={applying || changeCount === 0}>
              {applying ? 'Applying…' : `Apply selected (${changeCount})`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Wire it into `PipelineList`**

In `src/pages/PipelineList.tsx`:

1. Add imports:
   ```typescript
   import { Radar } from 'lucide-react';
   import { useLeadEnrichment } from '../hooks/useLeadEnrichment';
   import { EnrichmentReview } from '../components/pipeline/EnrichmentReview';
   import type { EnrichableField, EnrichmentResult } from '../types';
   ```
2. Add state and a `leadsById` lookup, alongside the other hooks/state:
   ```typescript
   const { running: enriching, error: enrichError, runEnrichment } = useLeadEnrichment();
   const [enrichResults, setEnrichResults] = useState<EnrichmentResult[]>([]);
   const [reviewOpen, setReviewOpen] = useState(false);
   const leadsById = useMemo(() => Object.fromEntries(leads.map((l) => [l.id, l])), [leads]);
   ```
   (`useMemo` is already imported in this file for `visible`.)
3. Add the two handlers:
   ```typescript
   async function handleFillMissingDetails() {
     const results = await runEnrichment([...selected]);
     setEnrichResults(results);
     setReviewOpen(true);
   }

   async function handleApplyEnrichment(grouped: Record<string, Partial<Record<EnrichableField, string>>>) {
     let applied = 0;
     const failed: { leadId: string; error: string }[] = [];
     for (const [leadId, patch] of Object.entries(grouped)) {
       const err = await updateLead(leadId, patch);
       if (err) failed.push({ leadId, error: err }); else applied++;
     }
     setSelected(new Set());
     return { applied, failed };
   }
   ```
4. Add the toolbar button, in the `<div className="flex items-center gap-3">` that already holds `<ViewToggle>` and the "Add lead" `<Button>`, placed between them:
   ```tsx
   {selected.size > 0 && (
     <Button variant="secondary" onClick={() => void handleFillMissingDetails()} disabled={enriching}>
       <Radar className="h-4 w-4" aria-hidden />
       {enriching ? 'Searching…' : `Fill missing details (${selected.size})`}
     </Button>
   )}
   ```
5. Show the enrichment error near the existing `{error && ...}` block:
   ```tsx
   {enrichError && <p role="alert" className="text-sm text-danger">{enrichError}</p>}
   ```
6. Render the modal at the bottom, alongside the existing `<AddLeadWizard>`/`<LeadPanel>`:
   ```tsx
   <EnrichmentReview
     open={reviewOpen}
     results={enrichResults}
     leadsById={leadsById}
     onClose={() => setReviewOpen(false)}
     onApply={handleApplyEnrichment}
   />
   ```

- [ ] **Step 4: Live-verify end-to-end in the browser**

Navigate to `/pipeline` (List view), select 2–3 leads whose org has at least
a Companies House key configured (from Task 3/5's verification), click "Fill
missing details (N)", screenshot to confirm the loading state
("Searching…") then the review modal opening with real from→to diff rows
and source tags. Uncheck one row, confirm the "Apply selected (N)" count
updates. Click Apply, confirm the summary line appears ("Updated N leads")
and the button area switches to "Close". Close the modal, confirm the
Pipeline table now shows the updated values for the leads you applied
changes to (query `select email, phone, owner_name from leads where id =
'<id>'` directly to double-check against the database, not just the UI).

- [ ] **Step 5: Run the full check and commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean.

```bash
git add src/hooks/useLeadEnrichment.ts src/components/pipeline/EnrichmentReview.tsx src/pages/PipelineList.tsx
git commit -m "feat: wire bulk lead enrichment into the Pipeline list"
```
