# Deep find stage 2: the right people, with LinkedIn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deep find finds a current, right-role person with a LinkedIn profile for most leads in any country, using a free self-hosted search service first and Gemini as the fallback.

**Architecture:** A SearXNG container joins the existing `lookup-worker` stack and is reached only through a new wrapper route `POST /search`. The edge side gets one search interface (SearXNG first, Gemini fallback), import-free role-search rules, and a role ladder inside the existing Deep find lead pass. Target roles live on the customer profile. Accepted people are saved as contacts with source `role_search` and flow into the existing address planner and check queue unchanged.

**Tech Stack:** TypeScript strict, Deno edge functions, Hono wrapper on Node, Docker Compose on the VPS, Postgres (Supabase), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-deep-find-power-design.md`, section 6 "Stage 2". Read it with this plan.

**Why now (measured 2026-11-15, 50 leads):** right-role person 18 of 50 (US 0 of 20), LinkedIn 1 of 50. 13 of 20 US leads produced no address to check because no person was found. Companies House is the only people source today.

**Depends on:** the verifier defects build (migration 076, branch `codex/verifier-v2-defects`) being merged first. This plan's migration is 077.

## Global Constraints

- Worker calls go only through `supabase/functions/_shared/workerClient.ts`. Usage is reserved before each request, refunded at most once and only when the worker did no work. Any error counts as refused (fail closed).
- Pure rules live in import-free modules with tests in `src/lib/*.test.ts|js`.
- Nothing in this plan sends, enrols, or changes `include_in_sequences` to true. Every contact this plan creates has `include_in_sequences = false`.
- RLS on every table; no existing policy or grant is loosened.
- No secrets, addresses, names or raw provider text in logs. Fixed reason codes only.
- Components stay under 150 lines. No hardcoded colours; existing tokens only.
- Gemini search calls spend the run's existing AI cap through `deep_find_reserve`; no new uncapped AI path.
- LinkedIn is never fetched or scraped. Only search-engine result titles, URLs and snippets are read.
- Gates for every commit: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs`, and in `worker/wrapper`: `npx tsc --noEmit`, `npx vitest run`. Env: `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-test-placeholder`.
- Local build only. No push, merge, deploy, migration run, VPS change or production call by the builder.

## Decisions fixed by this plan (the builder does not choose these)

| Item | Value |
|---|---|
| Searches per lead | at most 3 (one per ladder rung) |
| People saved per lead by role search | at most 2 |
| Results read per search | 8 |
| Search timeout | wrapper to SearXNG 12 s; edge to wrapper 15 s |
| Wrapper `/search` rate | 20 per minute, shared |
| Usage resource | `worker_search`, 1 unit per search, 400 per org per day, 1,200 worker-wide |
| Gemini fallback | only when SearXNG returned zero results, was throttled, or is not configured; costs 1 AI unit from the run cap; skipped with a plain line when the cap is reached |
| Role list size | up to 12 target roles and 12 fallback roles per profile, each 2 to 60 characters |
| Built-in final rung | `Owner`, `Founder`, `Managing Director`, `CEO`, `Director`, `President`, `General Manager` |
| Built-in fallback rung when the profile has none | `Operations Manager`, `Office Manager`, `Head of Operations`, `Executive Assistant`, `HR Manager` |
| Contact source | `role_search` |
| Company secretaries | no longer added as contacts |

**Claude's call, differing from spec item 5:** registry directors are still added (they proved 19 mailboxes in the UK scoring run) but rank after role-search people, and at most 3 are added when role search accepted someone. Secretaries are dropped as the spec says.

**Kevin, 2026-11-16:** directors stay as written here (the stricter fallback-only rule is not wanted). Team-page people (Task 5b) and the monthly Gemini search meter (Task 5c) are in this plan.

**Deferred, not in this plan:** CRO changes.

## Review Focus

1. A LinkedIn result for a person at a different company with a similar name ("Acme Cleaning" vs "Acme Cleaners Texas"): must be rejected, never saved. Test in Task 3.
2. A former employee ("Former Facilities Manager at X", "ex-X", a title naming another current employer): rejected. Test in Task 3.
3. SearXNG returns HTML, an error page, or 50 results with huge snippets: the wrapper returns at most 8 trimmed results or a fixed error code. Test in Task 1.
4. A profile with no roles, or a lead with no profile: the ladder still runs using the built-in rungs. Test in Task 5.
5. The same person found by role search and already saved from Companies House: one contact, blank title and LinkedIn filled, nothing overwritten. Test in Task 5.

---

### Task 1: Wrapper route `POST /search` and the SearXNG container

**Files:**
- Create: `worker/wrapper/src/search.ts`, `worker/wrapper/src/search.test.ts`
- Modify: `worker/wrapper/src/app.ts`, `worker/wrapper/src/app.test.ts`, `worker/wrapper/src/server.ts`
- Create: `worker/searxng/settings.yml`, `worker/searxng/NOTICE.md`
- Modify: `worker/docker-compose.yml` (or the compose file the repo keeps for `/opt/lookup-worker`; if the repo has none, create `worker/docker-compose.search.yml` as an override file and say so in the report)

**Interfaces:**
- Produces: `export interface SearchResult { title: string; url: string; snippet: string }`
- Produces: `export async function searchWeb(query: string, deps: { searxUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number; limit?: number }): Promise<{ ok: true; results: SearchResult[] } | { ok: false; error: 'timeout' | 'upstream' | 'throttled' | 'bad_response' }>`
- Produces: `AppDeps.search?: (query: string) => ReturnType<typeof searchWeb>` and `AppDeps.searchPerMinute?: number`
- HTTP: `POST /search {query: string}` returns `200 {results: SearchResult[]}`; `400 {error:'bad_request'}` when query is not a string of 3 to 300 characters; `429 {error:'rate_limited'}`; `503 {error:'not_configured'}` when `deps.search` is absent; `502 {error:'upstream'|'bad_response'}`; `504 {error:'timeout'}`; `429 {error:'throttled'}` when SearXNG reports every engine suspended or answers 429.

- [ ] **Step 1: Write failing tests** in `search.test.ts`: maps a SearXNG JSON reply (`{results:[{title,url,content}]}`) to at most 8 results; trims title to 200 and snippet to 400 characters; drops results whose url is not `http(s)`; non-JSON body gives `bad_response`; HTTP 429 gives `throttled`; an abort gives `timeout`; HTTP 500 gives `upstream`. In `app.test.ts`: the six HTTP cases above, and that the 21st call in a minute returns 429.
- [ ] **Step 2: Run** `npx vitest run src/search.test.ts src/app.test.ts` in `worker/wrapper`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `searchWeb`** calling `GET {searxUrl}/search?q=<query>&format=json&language=en&safesearch=0` with an abort timer (default 12,000 ms). No query text in logs.
- [ ] **Step 4: Add the route** to `app.ts` with its own `RateLimiter(deps.searchPerMinute ?? 20, 60_000)`, and wire `search` in `server.ts` from env `SEARX_URL` (absent means not configured).
- [ ] **Step 5: Add the container.** Service `searxng`: image `searxng/searxng` pinned by digest (record tag and digest in `NOTICE.md`), `mem_limit: 512m`, `cpus: 0.5`, `cap_drop: [ALL]` plus only the capabilities the image documents as required, `no-new-privileges`, `restart: unless-stopped`, no published ports, on a new internal network `search-link` shared only with `wrapper`. `settings.yml`: `search.formats: [html, json]`, `server.limiter: false`, `server.secret_key` from env `SEARXNG_SECRET`, engines enabled: google, bing, duckduckgo, brave, startpage, mojeek; everything else off; `outgoing.request_timeout: 8`. Wrapper env `SEARX_URL: "http://searxng:8080"`.
- [ ] **Step 6: Run** wrapper gates. Expected: PASS.
- [ ] **Step 7: Commit** `feat: worker search route and SearXNG service`.

### Task 2: Usage resource `worker_search` and the worker client method

**Files:**
- Create: `supabase/migrations/077_role_search.sql` (this task writes its usage part; Task 4 appends the rest), `supabase/audits/role_search.sql`
- Modify: `supabase/functions/_shared/usageRules.ts`, `supabase/functions/_shared/workerRules.ts`, `supabase/functions/_shared/workerClient.ts`, `src/lib/usageRules.test.ts`, `src/lib/workerRules.test.ts`, `src/lib/workerClient.test.ts`, and the usage meter label map wherever `USAGE_RESOURCES` is rendered

**Interfaces:**
- Consumes: Task 1's HTTP contract.
- Produces: `UsageResource` gains `'worker_search'` (label `Web searches`, noun `web searches`, orgLimit 400, globalLimit 1200).
- Produces in `workerRules.ts`: `export interface SearchHit { title: string; url: string; snippet: string }`, `export function parseSearchReply(json: unknown): SearchHit[] | null` (null when the shape is wrong; at most 8 hits; same trimming as the wrapper), `WORKER_RESOURCE.search = 'worker_search'`, `WORKER_TIMEOUT_MS.search = 15_000`.
- Produces in `workerClient.ts`: `search(query: string): Promise<WorkerResult<SearchHit[]>>` on `WorkerClient`, kind `'search'`, 1 unit, refunded under the existing `shouldRefund` rules. A 429 `throttled` reply is failure `busy` and stops the kind for the rest of the lead.

- [ ] **Step 1: Write failing tests:** `parseSearchReply` accepts the wrapper shape, rejects a non-array, caps at 8; `usageRules` knows the new resource and its limits; `workerClient.search` reserves 1 unit before the request, refunds on 503 and on network failure, does not refund on a client timeout, returns `limit_reached` with the existing refusal line when the reserve is refused.
- [ ] **Step 2: Run** `npx vitest run src/lib/usageRules.test.ts src/lib/workerRules.test.ts src/lib/workerClient.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three module changes. Follow the existing `msExists` method as the pattern.
- [ ] **Step 4: Write the migration part:** insert `usage_resources` row `('worker_search','Web searches',400,1200)`; widen any CHECK constraint on `usage_limits.resource`, `usage_counters.resource` and `usage_global_counters.resource` that lists resources (read migration 059 first; if there is no such constraint, write nothing for it). No grant or policy change.
- [ ] **Step 5: Write the audit** (rolled back): reserve passes at 400 and refuses at 401 for one org; refuses worker-wide at 1,201; anon and authenticated cannot write the counters.
- [ ] **Step 6: Run** all gates. Expected: PASS.
- [ ] **Step 7: Commit** `feat: worker_search usage resource and client method`.

### Task 3: Role-search rules (pure)

**Files:**
- Create: `supabase/functions/_shared/roleSearchRules.ts`, `src/lib/roleSearchRules.test.ts`

**Interfaces (all exported, import-free):**
- `export const ROLE_RUNG_FINAL: readonly string[]` and `export const ROLE_RUNG_FALLBACK_DEFAULT: readonly string[]` with the values in the decisions table.
- `export function cleanRoles(value: unknown): string[]` — trims, drops entries outside 2 to 60 characters, de-duplicates case-insensitively, keeps the first 12.
- `export function roleLadder(profile: { targetRoles?: unknown; fallbackRoles?: unknown } | null): { rung: 'target' | 'fallback' | 'final'; roles: string[] }[]` — target rung omitted when the profile has no target roles; fallback rung uses the default when the profile has none; final rung always present.
- `export function roleQuery(input: { company: string; city?: string | null; roles: string[] }): string` — `site:linkedin.com/in "<company>" ("<role 1>" OR "<role 2>" ...) <city>` using at most 5 roles; quotes inside the company name removed; total length capped at 300 by dropping roles from the end.
- `export interface RoleCandidate { first: string; last: string; title: string; linkedinUrl: string; rung: 'target' | 'fallback' | 'final' }`
- `export type RoleRejection = 'not_profile_url' | 'no_name' | 'company_mismatch' | 'former' | 'role_mismatch'`
- `export function judgeRoleHit(hit: { title: string; url: string; snippet: string }, lead: { company: string; registeredName?: string | null }, rung: { rung: RoleCandidate['rung']; roles: string[] }): { ok: true; person: RoleCandidate } | { ok: false; why: RoleRejection }`

**Acceptance rules for `judgeRoleHit` (the algorithm the tests pin):**
1. URL host is `linkedin.com` or a country subdomain and the path starts `/in/`. Query string and trailing slash are removed from the saved URL. Otherwise `not_profile_url`.
2. The result title is split on ` - `, ` – `, ` | ` after removing a trailing `LinkedIn`. First part is the name: two to four words, letters, hyphens and apostrophes only, else `no_name`.
3. Company match: every distinctive word of the lead's company (or registered name) appears as a whole word in the title or in the snippet's `Experience:` / `at <company>` text. Distinctive words are the name's words minus legal suffixes (ltd, limited, llc, inc, plc, co, company, group, the, and, &) and minus words shorter than 3 letters. A lead with no distinctive word never matches. Otherwise `company_mismatch`.
4. Former: reject as `former` when title or snippet contains `former`, `formerly`, `ex-`, `previously`, `retired`, `was a`, or a year range ending in a past year directly next to the company name (`2019 - 2022`), or when the title's company part names a different company than the lead while the lead appears only in the snippet.
5. Role: a role in the rung matches when all of its words appear as whole words in the title's role part or the snippet's first 160 characters, case-insensitive. Otherwise `role_mismatch`.

- [ ] **Step 1: Write failing tests,** one per rule and per review-focus item, including: `Jane Doe - Facilities Manager - Acme Offices Ltd | LinkedIn` accepted for lead `Acme Offices`; the same title for lead `Acme Cleaners Texas` rejected `company_mismatch`; `Former Facilities Manager at Acme Offices` rejected `former`; `/company/acme` rejected `not_profile_url`; `/pub/dir/` rejected; `uk.linkedin.com/in/jane-doe-1a2b3c?trk=x` saved as `https://uk.linkedin.com/in/jane-doe-1a2b3c`; `roleLadder(null)` gives fallback-default then final; `roleQuery` never exceeds 300 characters; `cleanRoles` caps at 12.
- [ ] **Step 2: Run** `npx vitest run src/lib/roleSearchRules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: role search rules`.

### Task 4: Target roles on the customer profile, and the `role_search` source

**Files:**
- Modify: `supabase/migrations/077_role_search.sql`, `supabase/audits/role_search.sql`
- Modify: the customer profile editor and its types (find them by searching `ideal_customer_profiles` under `src/`), `src/types/index.ts`
- Modify: wherever the contact source is labelled in the UI (search `companies_house` under `src/components`)

**Schema (exact):**
- `ALTER TABLE ideal_customer_profiles ADD COLUMN target_roles TEXT[] NOT NULL DEFAULT '{}', ADD COLUMN fallback_roles TEXT[] NOT NULL DEFAULT '{}';` each with a CHECK: `cardinality(...) <= 12`. Element length is enforced by a small IMMUTABLE helper used in the CHECK or by a BEFORE trigger; builder's choice, tested in the audit.
- `decision_maker_candidates.source` CHECK gains `'role_search'`.
- `role_search` is treated as a provider source everywhere `hunter`, `apollo`, `companies_house`, `cro` are: client INSERT stays refused, the provider-column guard trigger covers it, and the default `include_in_sequences = false` rule from migration 053 applies. Read migrations 050 and 053 and extend whatever lists those four.
- No policy or grant change on `ideal_customer_profiles` (existing admin-only writes cover the new columns).

**UI:** two fields in the profile editor, "Target roles" and "Fallback roles", one role per line, helper text "Deep find looks for these job titles first." / "Used when nobody in the target roles is found." Saved through `cleanRoles`. Contact source label: "Found by role search".

- [ ] **Step 1: Extend the audit** (rolled back): 13 roles refused; a 61-character role refused; member cannot update the columns, admin can; authenticated INSERT of a `role_search` contact refused; guard trigger blocks a client edit of provider columns on a `role_search` row.
- [ ] **Step 2: Write a failing UI test** for the editor: typing three lines saves a three-item array; blank lines dropped.
- [ ] **Step 3: Implement** migration, types, editor fields, label.
- [ ] **Step 4: Run** all gates. Expected: PASS.
- [ ] **Step 5: Commit** `feat: target roles on customer profiles and role_search contact source`.

### Task 5: The role ladder inside Deep find

**Files:**
- Create: `supabase/functions/_shared/roleSearch.ts` (wiring), `supabase/functions/_shared/searchProvider.ts`, `src/lib/roleSearch.test.js`, `src/lib/searchProvider.test.js`
- Modify: `supabase/functions/_shared/deepFind.ts`, `supabase/functions/_shared/registryOfficers.ts`, `supabase/functions/_shared/deepFindRules.ts` (step lines), their tests

**Interfaces:**
- Consumes: `WorkerClient.search`, `geminiGroundedSearch`, the run's AI reserve, `roleLadder`, `roleQuery`, `judgeRoleHit`.
- Produces: `export interface SearchProvider { search(query: string): Promise<{ ok: true; hits: SearchHit[]; via: 'searxng' | 'gemini' } | { ok: false; why: 'none' | 'limit' | 'cap' | 'failed' }> }` and `export function makeSearchProvider(deps: { worker: WorkerClient; gemini?: (prompt: string) => Promise<{ text: string; sources: string[] }>; reserveAi: () => Promise<boolean> }): SearchProvider`. SearXNG first. Gemini only on zero hits, `busy`, `not_configured` or `unreachable`. The Gemini prompt asks for up to 8 lines of strict JSON `{"title","url","snippet"}` copied from search results; lines that fail to parse, or whose url is not among the grounded sources, are dropped.
- Produces: `export async function findRolePeople(input: { company: string; registeredName?: string | null; city?: string | null; profile: { targetRoles?: unknown; fallbackRoles?: unknown } | null; provider: SearchProvider; timeLeftMs: () => number }): Promise<{ people: RoleCandidate[]; searches: number; via: ('searxng' | 'gemini')[]; stopped?: 'time' | 'limit' | 'cap' | 'failed' }>` — walks the ladder, stops at the first rung with an accepted person, at 3 searches, at 2 people, or when less than 20,000 ms remain.

**Deep find wiring (latitude: internal placement is the builder's, behaviour is not):**
1. Runs once per lead, after the company and its domains are settled and before people are chosen for address planning. Skipped with a plain line when the lead has no usable company name.
2. Profile: the lead's `icp_id` profile when set and in the lead's org; else the org's only profile when it has exactly one; else none.
3. Save each accepted person through the existing `prepareContacts` path: `source: 'role_search'`, `kind: 'person'`, title, `linkedin_url`, `include_in_sequences: false`, `created_by` the run creator. When a live contact with the same person key exists, fill only blank `title` and blank `linkedin_url` on it and insert nothing. Dismissed contacts are never revived.
4. Role-search people are first in the people order for address planning and the check queue (before registry officers, Hunter people and owner names).
5. Registry officers: `registryOfficers.ts` no longer returns role `secretary`. When role search accepted at least one person, add at most 3 officers; otherwise unchanged.
6. Step lines (exact): `Role search: found <n> (<Name, Title>; ...).` / `Role search: nobody in the target roles was found.` / `Role search: skipped, the web search allowance for today is used up.` / `Role search: skipped, the AI call cap was reached.` / `Role search: ran out of time.` Append ` Used the backup search.` when any search went through Gemini.
7. Readiness, tiers, sending and enrolment rules are untouched.

- [ ] **Step 1: Write failing tests:** provider falls back to Gemini only in the four listed cases and spends one AI unit; cap refusal returns `cap` without calling Gemini; ladder stops after the first rung with a hit; three searches maximum; two people maximum; time stop; existing-contact merge fills blanks only; dismissed contact not revived; secretary dropped; officer cap of 3 applies only after a role hit; each step line; no-profile path uses built-in rungs.
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement** `searchProvider.ts`, `roleSearch.ts`, then the Deep find wiring.
- [ ] **Step 4: Run** all gates. Expected: PASS. No existing assertion changes except the secretary and officer-count cases; list every changed assertion in the report.
- [ ] **Step 5: Commit** `feat: role search ladder in Deep find`.

### Task 5b: People named on the company's own team pages

**Files:**
- Create: `supabase/functions/_shared/teamPageRules.ts`, `src/lib/teamPageRules.test.ts`
- Modify: `supabase/functions/_shared/deepFind.ts`, `supabase/migrations/077_role_search.sql`, `supabase/audits/role_search.sql`, the contact source label map

**Interfaces (pure, import-free):**
- `export interface TeamPerson { first: string; last: string; title: string; linkedinUrl: string | null; sourceUrl: string }`
- `export function teamPeopleFromPage(page: { html: string; url: string }): TeamPerson[]` — at most 12 per page.
- `export function pickTeamPeople(people: TeamPerson[], ladder: ReturnType<typeof roleLadder>): (TeamPerson & { rung: 'target' | 'fallback' | 'final' })[]` — keeps only people whose title matches a ladder role (same whole-word rule as `judgeRoleHit` rule 5), best rung first, at most 2.

**Extraction rules (the tests pin these):**
1. Only pages already fetched for the lead on a confirmed, not-suspect company domain whose path contains `team`, `about`, `people`, `staff`, `leadership`, `management`, `who-we-are` or `our-story`. No new page fetches beyond what Deep find already does.
2. JSON-LD first: every `Person` object with `name` and `jobTitle`; `sameAs` or `url` on linkedin.com `/in/` becomes `linkedinUrl`.
3. Then HTML blocks: a heading or strong element holding a two-to-four-word name (letters, hyphens, apostrophes) followed within the same card or the next sibling element by a title of 2 to 80 characters. A LinkedIn `/in/` link inside the same card is taken. Text is tag-stripped with a `|` separator.
4. Rejected: names matching the company name, navigation or testimonial sections (ancestor id or class containing `testimonial`, `review`, `client`, `nav`, `footer`), titles that are sentences (more than 8 words or ending in a full stop).

**Wiring:** runs before the search ladder. A picked team person is saved exactly like a role-search person (same merge and dismissal rules, `include_in_sequences: false`) with `source: 'team_page'`. Each picked person counts toward the 2-people limit, and a `target` rung team person means the search ladder is skipped for that lead (saves the searches). Step line: `Team page: found <n> (<Name, Title>; ...).` Nothing is logged when none are found.

**Schema:** add `'team_page'` to the same CHECK and provider-source lists as `role_search` in migration 077. UI label: "From the company's team page".

- [ ] **Step 1: Write failing tests:** JSON-LD person; card with h3 name and p title; LinkedIn link picked from the card; testimonial block ignored; sentence title ignored; company-name heading ignored; 12 cap; `pickTeamPeople` orders by rung and caps at 2; a suspect or unconfirmed domain yields nothing; target-rung hit skips the search ladder; fallback-rung hit does not.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** rules, wiring, migration line, audit case (client INSERT of a `team_page` contact refused), label.
- [ ] **Step 4: Run** all gates. Expected: PASS.
- [ ] **Step 5: Commit** `feat: people from company team pages`.

### Task 5c: Monthly Gemini search meter

**Files:**
- Modify: `supabase/migrations/077_role_search.sql`, `supabase/audits/role_search.sql`
- Create: `supabase/functions/_shared/geminiSearchMeter.ts`, `src/lib/geminiSearchMeter.test.js`
- Modify: every caller of `geminiGroundedSearch` (list them with a search; today: `knownPersonLookup.ts`, `leadResearch.ts`, the company web proof, and Task 5's provider), the usage meter panel under `src/components` and its hook

**Schema (exact):**
- Table `gemini_search_usage (org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, month DATE NOT NULL, shared_key BOOLEAN NOT NULL, searches INTEGER NOT NULL DEFAULT 0 CHECK (searches >= 0), PRIMARY KEY (org_id, month, shared_key))`. RLS on; no client write; SELECT for org members only.
- `gemini_search_count(p_org UUID, p_shared BOOLEAN, p_n INTEGER)` SECURITY DEFINER, service role only, fixed search_path: atomic upsert adding `p_n` (1 to 20) to the current London-month row.
- `gemini_search_snapshot(p_org UUID)` for members: this month's org count, and when the org uses the shared key, the total across all shared-key orgs (a number only, no other org's rows).

**Rules:**
- `export const GEMINI_FREE_SEARCHES_PER_MONTH = 5000`.
- `export async function countGeminiSearch(service, orgId: string, sharedKey: boolean): Promise<void>` — called once after each `geminiGroundedSearch` call that reached Google (success or provider error; not on a local timeout before dispatch). A counting failure is logged with a fixed code and never fails the lookup.
- Counting is per call, not per search query Gemini issues internally; the panel says "about".
- The meter never blocks a search. It is information only; the run's AI cap stays the control.

**UI:** one line in the existing usage panel: `Web searches by Gemini this month: about <n> of 5,000 free.` Amber from 4,000, red from 5,000 with `Searches beyond this are billed by Google.` For shared-key orgs the number is the shared total. Loaded on first open like the Hunter line.

- [ ] **Step 1: Write failing tests:** count called once per dispatched search and not on a pre-dispatch timeout; count failure does not fail the lookup; snapshot text and the amber and red thresholds; audit cases (client cannot write; member of another org cannot read; shared total returns a number only; `p_n` of 0 or 21 refused).
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all gates. Expected: PASS.
- [ ] **Step 5: Commit** `feat: monthly Gemini search meter`.

### Task 6: Scoring script and report

**Files:**
- Modify: `scripts/deepfind-score.sql`
- Create: `docs/STAGE2-PEOPLE-BUILD-REPORT.md`; modify the top of `docs/HANDOFF.md`

- [ ] **Step 1:** The script takes a list of run ids instead of one pipeline, and prints per run: leads, ready, leads with a `role_search` or `team_page` person, leads with any titled person, leads with a LinkedIn URL, leads with two or more channels, company-match flags, queue totals by verdict and reason, searches used by provider (from step lines or a counter the builder adds to the lead result JSON; say which).
- [ ] **Step 2:** Report: what was built per task, commits, gate counts, every changed existing assertion, the redeploy list (edge functions by import graph, wrapper, compose), the exact VPS steps for rollout, anything unverified, and plan gaps.
- [ ] **Step 3: Commit** `docs: stage 2 people build report`.

## Rollout (Claude, after review, each step on Kevin's yes)

1. Fresh Hostinger snapshot. Read-only checks. n8n and Postiz untouched.
2. Deploy SearXNG and the new wrapper; confirm `/search` answers and that SearXNG is not reachable from outside the wrapper.
3. Rolled-back dry run of 077 on production, then apply.
4. Deploy edge functions from the report's list; merge and push.
5. Seed target roles on existing profiles with Kevin's values from the spec.
6. Re-run the same 50 leads and score.

## Unknowns the build cannot settle

- How fast search engines throttle one server address at 200 to 400 queries a day. Measured at rollout; several engines are enabled so one engine suspending does not stop searches.
- Whether LinkedIn result titles keep the `Name - Role - Company` shape across engines. The rules reject what they cannot parse; the acceptance rate is measured on the 50-lead set.
