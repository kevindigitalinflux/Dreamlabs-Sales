# Bulk Lead Enrichment — Design Spec

## Overview

CSV-imported leads frequently land in the pipeline missing contact details — no
email, no owner name, no phone. Today there is no way to fill those gaps except
editing each lead by hand. This spec adds a **bulk enrichment** action on the
Pipeline list: multi-select leads (or select all), run a lookup pass across
several sources, review every found value as a diff, and apply only what you
choose to keep.

**Provider strategy, decided during brainstorming:** the existing paid
enrichment (`enrich-apollo`, `enrich-hunter`) only operates on `raw_leads`
(pre-import scraper results) and requires a paid Apollo/Hunter plan most orgs
won't have. This feature must work without either. It uses a **free-first
waterfall**:

1. **Website scrape** (free, no key) — fetch the lead's own website, regex for
   `mailto:`/`tel:` links → email, phone. Already proven in production inside
   `scrape-google-places/index.ts`'s `findEmail()`; this spec promotes that
   logic to `_shared/` and extends it with a phone variant.
2. **Companies House officer lookup** (free registration, UK only) — search by
   business name, take the best match, pull its first registered
   officer/director → owner_name. Already proven in production inside
   `scrape-companies-house/index.ts`'s `fetchFirstOfficer()`; this spec reuses
   the same call shape against leads instead of scrape-job ICP results.
3. **OpenCorporates officer lookup** (free tier, 200 requests/month, requires a
   free API key — new provider, same shape as Companies House) — same idea as
   #2 but for non-UK jurisdictions. Coverage varies by country depending on
   what OpenCorporates has ingested from that jurisdiction's registry; this is
   a best-effort extra, not a guarantee.
4. **Apollo / Hunter** (paid, opt-in, only if the org has already configured a
   key in Organization Settings) — tried **last**, and only for a field still
   blank after steps 1–3, so paid credits are spent only where every free
   source came up empty.

Every found value — whether filling a blank field or proposing to overwrite an
existing one — is shown to the user as an explicit from→to diff before
anything is written. Nothing is applied silently.

## Data Flow

```
User selects leads on Pipeline (List view) → clicks "Fill missing details" →
client calls enrich-leads-bulk with the selected lead_ids →
edge function runs the waterfall per lead, bounded concurrency →
returns { lead_id, proposed: { email?, phone?, owner_name? }, source: {...} } per lead
  (leads where nothing was found are omitted entirely) →
client renders a review panel: one row per lead with a change, each field
individually checkable (checked by default) →
user clicks "Apply selected (N changes)" →
client issues one leads.update() per lead for its checked fields (plain
RLS-protected write, no new edge function) →
Pipeline's lead list refreshes
```

## New Edge Function: `enrich-leads-bulk`

**Request:** `POST { lead_ids: string[] }` (auth'd user, no org_id in the
body — org is derived server-side from the leads themselves, same
never-trust-a-client-supplied-org_id discipline as `enrich-apollo`).

**Auth/authorization:**
1. Resolve the signed-in user via the anon client + `Authorization` header
   (same pattern as every other function here).
2. Cap `lead_ids` at 40 — reject with a 400 if more are sent (`"Select 40 or
   fewer leads at once"`). This mirrors `scrape-companies-house`'s existing
   `cap = Math.min(30, ...)` order of magnitude and keeps the request
   comfortably inside typical edge-function timeouts even in the worst case
   (every lead missing a website, so every lookup path is attempted).
3. Fetch the requested leads via the service-role client, selecting
   `id, org_id, business_name, website, email, phone, owner_name`. Any
   `lead_id` that doesn't resolve is silently dropped from the batch (not an
   error — the client's own selection state should never desync badly enough
   to matter, but a stale id must not fail the whole request).
4. All resolved leads must share exactly one `org_id`, and the caller must be
   a member of it (`org_members` check) — reject with 403 otherwise. Bulk
   selection only ever happens within one Pipeline (one org) in the UI, so
   this should never trigger in practice; it exists as the defensive
   boundary, same posture as every other function that derives org_id from
   owned rows.

**Per-lead lookup** (bounded concurrency 5, via the existing `runBounded`
helper — lower than `scrape-google-places`'s 8 since this function does up to
four sequential lookups per lead, not one):

```typescript
async function enrichOneLead(
  lead: { id: string; business_name: string; website: string | null; email: string | null; phone: string | null; owner_name: string | null },
  keys: { companiesHouse: string | null; openCorporates: string | null; apollo: string | null; hunter: string | null },
): Promise<{ lead_id: string; proposed: Record<string, string>; source: Record<string, string> } | null> {
  const proposed: Record<string, string> = {};
  const source: Record<string, string> = {};

  // 1. Website scrape — free, no key required.
  if (lead.website) {
    const { email, phone } = await scrapeWebsiteContact(lead.website); // _shared/websiteContact.ts
    if (email && email !== lead.email) { proposed.email = email; source.email = 'website'; }
    if (phone && phone !== lead.phone) { proposed.phone = phone; source.phone = 'website'; }
  }

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
```

Every individual lookup function catches its own errors and returns `null` on
failure (network error, no match, quota exhausted, invalid key) — one bad
lookup or one exhausted quota must never fail the batch or the other leads in
it, matching the existing `fetchPlaceDetails`/`fetchFirstOfficer` convention
of catch-and-return-null.

`keys` is resolved once per request (not per lead) via `resolveOrgApiKey`,
one call per provider, all against the batch's single shared `org_id`.

**Response:** `{ results: Array<{ lead_id, proposed, source }> }` — leads with
no findings are simply absent from the array.

## New Shared Helpers

- **`_shared/websiteContact.ts`** — `scrapeWebsiteContact(website: string):
  Promise<{ email: string | null; phone: string | null }>`. Promotes
  `findEmail()` out of `scrape-google-places/index.ts` (kept working there,
  now imported from here) and adds a parallel phone extraction: `tel:` links
  first, then a plain-text UK/international phone-pattern regex as a fallback
  — mirroring `findEmail`'s own mailto-then-plaintext fallback shape. Same
  5-second abort-controller timeout, same `User-Agent` header, same
  false-positive guards as the existing email regex (asset-extension
  exclusion list).
- **Companies House officer lookup** — extracted from
  `scrape-companies-house/index.ts` into a reusable function taking a
  business name instead of a pre-fetched company list: search
  `/search/companies?q=<name>`, take the top result, call
  `fetchFirstOfficer(company_number, apiKey)` (already exists, reused
  as-is), apply the existing `normalizeOfficerName` formatting. A fuzzy-match
  guard is required before trusting the result: only use the top search
  result if its `title` case-insensitively contains the lead's
  `business_name` (or vice versa) — otherwise treat as no match, to avoid
  attaching a stranger's name to the wrong company.
- **OpenCorporates officer lookup** (new) — `GET
  /v0.4/companies/search?q=<name>&api_token=<key>` to find a jurisdiction +
  company number (same fuzzy-match guard as Companies House above), then `GET
  /v0.4/companies/:jurisdiction_code/:company_number?api_token=<key>` and take
  the first entry in the response's `officers` array. OpenCorporates' default
  free tier is capped at 200 requests/month and 50/day — expect it to run out
  quickly on anything but small batches; this is disclosed in the UI (see
  below), not hidden.

## New Org API Provider: OpenCorporates

Same shape as every existing BYO-key provider:

- `supabase/migrations/026_opencorporates_provider.sql`: widen the
  `org_api_settings.provider` CHECK constraint (currently `'gemini','google_
  places','companies_house','apollo','hunter'` in `004_lead_scraper.sql`, and
  separately `...,'anthropic'` in `006_outreach_automation.sql`) to also
  include `'opencorporates'`.
- `_shared/orgApiKeys.ts`: add `opencorporates` to the `ApiProvider` union and
  `GLOBAL_ENV_VARS` — it belongs on the **free-fallback tier** with
  Gemini/Places/Companies House (Kevin's own 2 orgs can use a shared key if
  one is ever configured), not the paid never-fallback tier Apollo/Hunter use.
- `org-api-settings/index.ts`: add `opencorporates` to the `Provider` type,
  the save-action whitelist array, and a `validateKey` branch — a lightweight
  `GET /v0.4/companies/search?q=test&api_token=<key>` call, `res.ok` as the
  pass/fail signal (mirrors the existing Companies House validation shape;
  OpenCorporates' public docs don't specify the exact invalid-key error body,
  so treat any non-2xx as rejection, same posture the Hunter/Apollo branches
  already take with unknown-shape errors).
- `src/hooks/useOrgApiSettings.ts`: add `'opencorporates'` to the
  `OrgApiSetting['provider']` union.
- `src/pages/OrganizationSettings.tsx`: add an entry to the `PROVIDERS` array:
  label "OpenCorporates (owner lookup outside the UK)", url
  `https://opencorporates.com/api_accounts/new`, freeText disclosing the free
  tier's 200/month, 50/day caps and that it's optional — Companies House
  alone already covers UK companies.

## UI: Multi-select on the Pipeline List

`src/components/pipeline/ListTable.tsx` gains the same checkbox pattern
already proven in `ScraperJob.tsx`: a header "select all" checkbox and a
per-row checkbox, lifted into `PipelineList.tsx`'s own `selected: Set<string>`
state (new — `ListTable` currently has no selection concept at all). New
props: `selected: Set<string>`, `onToggle: (id: string) => void`,
`onToggleAll: () => void`. "Select all" operates on `visible` — the already
filtered/sorted lead array `PipelineList` renders — not every lead in the
pipeline, matching `ScraperJob.tsx`'s own `toggleSelectAll(pending.map(...))`
precedent of selecting-all-currently-shown rather than an unfiltered
underlying set. Selection is cleared (not just visually, the `Set` itself)
whenever `filters` changes, so a stale selection can't silently include leads
no longer visible.

`PipelineList.tsx`'s toolbar (next to the existing "Add lead" button) shows a
"Fill missing details" button (Radar icon — the same icon already used for
scraping elsewhere in this app, per established icon-reuse convention) only
when `selected.size > 0`. Clicking it invokes `enrich-leads-bulk`, shows a
loading state on the button, then opens the review panel described below.
Selection clears after a successful Apply; it is preserved if the user
Cancels (so they can immediately re-run with a different selection without
re-picking).

## UI: Review Panel

New component `src/components/pipeline/EnrichmentReview.tsx`, a `Modal`
(reusing the existing `Modal` primitive) listing one section per lead that had
at least one finding:

```
<lead business name>
  Email      old@value.com → new@value.com          [Companies House/website/Hunter — source label]  ☑
  Phone      —              → +44 20 1234 5678       [website]                                        ☑
  Owner      —              → Jane Smith             [Companies House]                                ☑
```

Each row is an individually-checked checkbox, checked by default, using the
same from→to visual language already established in Dream Agent's
`ActionRow` (`text-muted line-through` for the old value, `text-success` for
the new one, an `ArrowRight` icon between). A small source tag per row
(reusing the `source` field from the API response) tells the user which
provider supplied the value, so a website-sourced email and a
Companies-House-sourced name read differently at a glance.

Footer: "Apply selected (N changes)" / "Cancel". Applying loops the checked
`{lead_id, field, value}` triples, groups them by `lead_id`, and issues one
`supabase.from('leads').update({...fields}).eq('id', lead_id)` per lead —
plain client-side writes already covered by the existing `leads_update` RLS
policy, no new edge function needed for the write path. On completion: close
the modal, show a one-line summary ("Updated 12 leads"), refresh the lead
list, clear selection.

## Error Handling

- Selecting more than 40 leads: the "Fill missing details" button stays
  enabled (so the user gets the real error, not a silently-capped guess) but
  the edge function's 400 response is surfaced as an inline error near the
  button: "Select 40 or fewer leads at once."
- A lead with no website and no UK/registerable company match: simply
  produces no findings and doesn't appear in the review panel — not an error,
  just nothing to show.
- Provider quota exhausted mid-batch (e.g. OpenCorporates' 200/month limit
  hit on lead 15 of 40): that provider's lookups silently stop contributing
  for the rest of the batch (each call still individually catches and returns
  null); the batch completes normally with whatever was found before the
  quota ran out.
- Apply-step partial failure (e.g. one lead's RLS write fails because it was
  reassigned mid-review): collect per-lead errors, apply everything that
  succeeded, and show a summary distinguishing "Updated 11 leads — 1 failed:
  <reason>" rather than failing the whole apply.

## Testing

- `scrapeWebsiteContact` (phone extraction path): unit tests mirroring the
  existing email-extraction test coverage — `tel:` link match, plain-text
  phone pattern fallback, no match, malformed HTML, fetch timeout.
- Companies House / OpenCorporates officer lookup: unit test the fuzzy-match
  guard specifically (exact match passes, wildly different business name
  fails, case-insensitive substring passes).
- `enrich-leads-bulk`: integration-style test (or manual live verification,
  matching this codebase's established pattern for edge functions without a
  local Postgres harness) covering: cap enforcement (41 leads → 400), 403 for
  a non-member, mixed results (some leads find data, some don't, response
  array only contains the former), and the free-then-paid ordering (assert
  Hunter/Apollo are never called when the website scrape already found an
  email).
- `EnrichmentReview`: component test for per-checkbox toggling and the
  grouped-apply payload shape (N checked rows across M leads → exactly M
  `update()` calls, each containing only that lead's checked fields).
