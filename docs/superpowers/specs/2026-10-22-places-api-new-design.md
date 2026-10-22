# Google Places API (New) source, with a monthly search guardrail — Design

Date: 2026-10-22. Author: Claude (architect). Status: DRAFT for Kevin's go-ahead; build by Codex on branch `codex/places-new` in the separate worktree `C:\Users\kevin\Projects\dreamlabs-sales-places`. Not built.

## Why
- Google removed the legacy Places API for new projects. Google's page "Places API (Legacy) overview" (updated 2026-10-20) says: "As of October 2026, Places API (Legacy) can no longer be enabled for new Google Cloud projects. Existing projects remain fully supported."
- Valentina (UX Tree) has a new Google Cloud project, so her key can only call Places API (New). Our scraper, the lead lookup and the key validator call only the legacy endpoints (`maps.googleapis.com/maps/api/place/...`). Result: "Google rejected the key (REQUEST_DENIED)". Every future organisation will hit the same wall.
- Kevin's own project is old enough to keep legacy access, so Mr Brush & Co and DI Dreamlabs work today and must keep working during and after this change.

## Kevin's decisions (kickoff, 2026-10-22)
1. Codex builds in a separate worktree; Claude reviews.
2. **New API first, legacy fallback.** One "Google Places" key slot per organisation. The code calls Places API (New) and falls back to legacy only when the key's project has legacy access.
3. **Default monthly guardrail**, adjustable, with a plain message at the cap. (Number revised below, see "Finding that changes the cost design".)
4. Phone and website: Kevin chose "Pro fields only, site scrape first". See the finding below; this spec replaces that part and Kevin must confirm it.

## Finding that changes the cost design (Kevin must confirm)
Verified on Google's pricing page and the Text Search (New) field list (2026-10-22):

| Text Search (New) tier | Fields that trigger it | Free events per month (per billing account) | Price per 1,000 after |
|---|---|---|---|
| IDs only | `places.id` | unlimited | $0 |
| Pro | `displayName`, `formattedAddress`, `addressComponents`, `location`, `types`, `businessStatus` | 5,000 | $32 |
| Enterprise | `websiteUri`, `nationalPhoneNumber`, `internationalPhoneNumber`, `rating`, `userRatingCount` | 1,000 | $35 |

- One event is one Text Search request. A request returns up to 20 places (`pageSize` max 20), so the scraper's 60 results are 3 events.
- The scraper needs the website (that is how it finds email), the phone, and rating/review count (the ICP filters `min_rating`, `max_rating`, `max_reviews` and the stored `google_rating`, `review_count`). All of these are Enterprise fields.
- **Pro-only searches would return no website, no phone and no rating.** Getting them per place with Place Details (Enterprise: 1,000 free per month, $20 per 1,000) would cost one event per place, which is about 20 times more events than reading them in the search itself.
- **Therefore the efficient design is a single Text Search at the Enterprise tier:** 3 events per 60-lead scrape, 1,000 free events per month = about 333 full scrapes (about 20,000 places) free per month. The earlier "Pro fields only" answer would have been worse for this app.
- Free caps are counted per billing account across all its projects. Mr Brush & Co and DI Dreamlabs share Kevin's key (and billing account) through `use_global_api_fallback`; UX Tree uses Valentina's own account.

**Decision this spec follows (unless Kevin objects):** Text Search at the Enterprise tier for the scraper and for single-business lookups. Default guardrail: **900 billable Google Places events per organisation per month** (leaves 10 percent under the free 1,000). No Place Details call is made.

## Design

### 1. Shared Places client
New import-light module `supabase/functions/_shared/placesClient.ts` (plus pure helpers in `placesNew.ts` so they can be tested from `src/lib`):
- `searchPlaces(apiKey, query, opts)`: POST `https://places.googleapis.com/v1/places:searchText`, headers `X-Goog-Api-Key` and `X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.addressComponents,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,nextPageToken`, body `{ textQuery, pageSize: 20, languageCode: 'en', pageToken? }`. Up to 3 pages, no artificial delay. Maps the response into the existing shapes (`PlaceResult`: `place_id`, `name`, `formatted_address`, `rating`, `user_ratings_total`; details: `phone`, `website`) so downstream code does not change.
- Phone: store `nationalPhoneNumber` where the legacy code stored `formatted_phone_number` (same national format).
- The API key travels only in the header, never in a URL, and is never logged.
- Error classification (pure, tested): `not_enabled` (HTTP 403 with reason `SERVICE_DISABLED`, `API_KEY_SERVICE_BLOCKED` or "has not been used" text), `denied` (other 403 or 400 invalid key), `quota` (429 or `RESOURCE_EXHAUSTED`), `bad_request`, `network`.
- **Legacy fallback.** On `not_enabled` only, retry the same operation through the existing legacy code path (kept unchanged in the same module). Remember the outcome for the rest of the run so only the first call pays the extra request. On `quota`, `denied` or `network`, do not fall back; report the plain message.
- `scrape-google-places` and `googlePlacesLookup.ts` call this client instead of fetching directly. `lookupPlaceContact` becomes one Text Search (Enterprise fields) per business and picks the best of the top 3 with the existing `placeMatchStrength`; the separate Details call is removed on the New path (legacy path keeps its Details call). City matching uses `addressComponents` (`locality` / `postal_town`) exactly as now.

### 2. Key validation and plain errors
`org-api-settings` `validateKey` for `google_places`:
- Call Text Search (New) with field mask `places.id` (free, unlimited tier). Success means the key works.
- If that fails with `not_enabled`, try the legacy check that exists today; success on legacy also validates the key.
- Otherwise show a plain message that includes Google's own reason, for example: "Google says: Places API (New) has not been used in project 123 or it is disabled. Enable it in the Google Cloud library and wait two minutes." Never echo the key. Map the common cases to short instructions: not enabled, billing not enabled, key restricted to other APIs or websites, invalid key.
- The existing `google_places_pro` provider is no longer needed in the UI (see section 5). The enum value and any stored key stay untouched (additive, nothing deleted).

### 3. Monthly guardrail (hard stop)
New additive migration (next free number at build time; 065 is reserved for the readiness badge and 066 is used by platform-owners). Mirror migration 059's security style:
- `places_usage_limits (org_id, monthly_limit INT CHECK (monthly_limit BETWEEN 0 AND 100000), updated_by, updated_at)`; org admins may read and edit their own organisation's limit through RLS, like `usage_limits`. Default when no row exists: 900.
- `places_usage_counters (org_id, month DATE, used INT)`, no client write access; members may read their own organisation's row.
- Optional shared pool row for calls made with the **global fallback key** (Kevin's key), default 900 for all fallback organisations combined, so Mr Brush & Co and DI Dreamlabs together cannot exceed Kevin's free cap. Codex must check whether `resolveOrgApiKey` can report that the global key was used; if it cannot, extend it to return `{ key, source }` without changing existing callers, or document the gap.
- RPCs, `SECURITY DEFINER`, `search_path = ''`, executable by `service_role` only: `places_reserve(p_org, p_units)` (atomic: lock the shared row first, then the organisation row; returns ok or the reason and the numbers), `places_refund(p_org, p_units, p_month)` (only units actually reserved this month), and `places_snapshot(p_org)` for the UI meter (member check inside, like `usage_snapshot`).
- Month = calendar month in `America/Los_Angeles` (Google bills in Pacific Time), so our counter resets when Google's does.
- Use: the scraper reserves 3 events before starting a job (refunds unused pages when the job returns fewer); each single-business lookup reserves 1. At the cap: the scrape job fails fast with "Monthly Google Places limit reached (900 of 900). It resets on 1 November. An admin can raise the limit in Organization settings." Deep find / Fill-details lookups skip the Google step with a plain step line and continue.
- Legacy fallback requests count against the same counter (conservative). Legacy requests made for organisations that never reach the New path (Kevin's orgs before they enable the New API) were uncapped before and stay as they are; the cap applies to all calls routed through the new client.
- Add a Pacific-time month boundary test and a concurrency test like `scripts/usage-concurrency-test.mjs`.

### 4. Google-side guardrails (documented in the app, no code)
In the Google Places setup card, add steps that give a second, independent limit on the customer's own Google account: (a) Billing → Budgets & alerts: create a budget with email alerts at 50, 90 and 100 percent; (b) APIs & Services → Places API (New) → Quotas: set "Text Search requests per day" to a small number (for example 100). Plain wording, no jargon.

### 5. App copy (docs-only changes in `src/pages/OrganizationSettings.tsx`)
- Rewrite the `google_places` card: it now uses Places API (New) (and still works with a legacy-enabled project). Steps: open the link, pick or create a project, enable billing, search the library for **Places API (New)** and Enable, create or reuse the API key, restrict it to Places API (New) (do not restrict by website or app), paste it here.
- Correct the free-usage text: Google gives free monthly events for Places API (New) (1,000 at the tier we use, counted per billing account); the app stops at the limit set here; charges apply only above Google's free amount. Remove the text claiming there is "no free tier".
- Remove the separate "Google Places Pro (optional, not yet used)" card from the list (the provider value stays in the database and code so nothing breaks).
- Show a small meter in the Google Places card: "Google searches this month: 120 of 900. Resets 1 November." with an admin-only field to change the limit (0 to 100,000), reading `places_snapshot`.

### 6. Rollout order
1. Merge `codex/platform-owners` first (it also edits `org-api-settings/index.ts`, in a different region); rebase `codex/places-new` on it before merging.
2. Kevin applies the new migration and runs its audit script (`supabase/audits/places_usage.sql`, rolls back, ends with the mandatory final exception).
3. Deploy, each with Kevin's yes: `org-api-settings`, `scrape-google-places`, every function that imports `googlePlacesLookup.ts` or the new client (find with grep at build time: at least `run-deep-find`, `enrich-leads-bulk`, `run-autopilot`, `run-lookup-jobs`, `run-selected-autopilot`, `scrape-companies-house`, `scrape-cro`).
4. Deploy the front end after the migration is live (the meter calls the new RPC; the component must also tolerate the RPC being absent).
5. Live test with Valentina's key: save the key (validation passes), run one scrape with `max_results` 20, check the meter shows 1 event used, and check that results include website, phone and rating.
6. Kevin enables **Places API (New)** on his own Google project and adds it to the key's API restrictions, so Mr Brush & Co and DI Dreamlabs move to the New path. Until then they stay on legacy through the fallback. After that, Kevin sets Mr Brush & Co and DI Dreamlabs to 450 events each (same billing account and free cap), and UX Tree stays at 900.

### 7. Out of scope
Photos, reviews text, autocomplete, nearby search, Gulf region parameters (`regionCode`, see the Gulf spec), a paid-tier mode, any change to the stored API-key handling or `use_global_api_fallback`, removing the legacy code or the `google_places_pro` provider value.

## Tests
- Pure tests in `src/lib/placesNew.test.ts`: request body and field mask (exactly the fields above, no others), response mapping to the existing shapes, missing fields, pagination token handling, error classification for each case, legacy fallback decision, Pacific month boundary.
- Quota tests mirroring `usageRules` tests, plus an SQL audit for grants (anon and authenticated cannot execute the RPCs; a member cannot read another organisation's counter; a non-admin cannot change a limit).
- Existing tests `googlePlacesSafety.test.ts`, `scrapeSearch.test.ts` and the lookup tests must keep passing.
- Gates before handoff: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, plus the local edge shim typecheck used on earlier branches.

## Risks to watch in review
- Never log the key or a URL containing it; the New path keeps the key in a header.
- Fallback must not double-bill every call: one extra request per run at most.
- `rating` and `userRatingCount` are Enterprise fields; the field mask must be exactly what the spec lists so no accidental Atmosphere fields (reviews, opening hours) are requested, which would move requests to the more expensive Enterprise + Atmosphere tier ($40 per 1,000).
- The cap must fail closed: any error from the reserve RPC counts as refused.
- Free caps are per billing account, so two organisations on one account share them; the shared-pool row exists for exactly this.


## Local implementation checkpoint (2026-10-22)
Kevin explicitly authorized the Enterprise-tier design and helper-first local build. Implementation is on codex/places-new in the separate places worktree. The authoritative build/review report is docs/PLACES-NEW-BUILD-REPORT.md; it records migration 067, passing local gates and remaining grant/accounting/cache decisions. This checkpoint does not approve those clarifications, the migration, rollout or live operations. Independent architect review remains pending.
