# Registry Contacts (Companies House + CRO) and Selected-Leads Autopilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registry searches (Companies House, new CRO) produce a company lead plus decision-maker candidates with contact lookup; autopilot gains a "Selected leads" mode that researches, drafts, sends and records outreach for hand-picked leads inside a daily time window.

**Architecture:** Additive migrations first (applied before any code that reads them). Pure logic lives in dependency-free modules (`supabase/functions/_shared/*.ts` with no `npm:`/`Deno` imports) and is unit-tested from `src/lib/*.test.ts` via relative imports. Edge functions stay thin orchestrators. The new engine (`run-selected-autopilot`) is cron-driven and uses the service role, so every lead id is re-validated against the run's org. Sending is extracted from `send-email` into a shared helper so the engine can send as the run's creator without a user JWT.

**Tech Stack:** React 18 + TS strict + Tailwind, Supabase (Postgres RLS, Edge Functions on Deno, pg_cron, Realtime, Vault), Vitest, Gemini (grounded search) + Claude (Sonnet notes, Haiku drafts).

**Spec:** `docs/superpowers/specs/2026-10-07-registry-contacts-and-selected-autopilot-design.md`

## Global Constraints

- TypeScript strict, no `any`, named exports only, JSDoc on every exported function, components under ~150 lines, Tailwind utility classes only.
- Migrations are additive and applied via the Supabase MCP (`apply_migration`) **before** deploying code that selects the new columns. Next numbers: `047`, `048`, `049`.
- Any service-role edge function that accepts a client-supplied id must re-check `org_members` for the caller (or derive org from the row), per CLAUDE.md.
- RLS enabled on every new table; never disable or loosen existing policies.
- AI JSON calls go through `_shared/ai.ts` helpers (stop-reason check + retry). AI-written email text passes `stripAiPunctuation`.
- No em/en dashes in user-facing copy and AI prompts follow `DASH_GUARDRAIL_LINE`.
- Deploy: `SUPABASE_ACCESS_TOKEN="$(grep '^SUPABASE_ACCESS_TOKEN=' /c/Users/kevin/Projects/dreamlabs-sales/.env | cut -d= -f2-)" npx supabase functions deploy <fns> --project-ref wgomksxelyfkzepbnkdd`.
- Verify after every task: `npx tsc --noEmit`, `npx vitest run`, and (UI tasks) `npm run build`, run one at a time in the foreground. Edge-function syntax check: `npx tsc --noEmit --ignoreConfig --skipLibCheck --allowImportingTsExtensions --target esnext --module esnext --moduleResolution bundler --strict false <file>` and grep `error TS1`.
- Commit messages `feat:`/`fix:`/`chore:`; end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; push with `git push origin HEAD:main` only when the user's workflow allows (user pushes to main and tests on sales.didreamlabs.com).
- When editing with node scripts avoid `\\n` in template literals and apostrophes in single-quoted strings; prefer the Edit tool.
- Candidate writes are service-role only (no client INSERT policy on `decision_maker_candidates`).

## Review Focus

- Registry returns zero officers (CRO free data, or a dormant company): lead still created, no candidates, no error.
- Officer names in `SURNAME, Forename Middle` form, corporate officers (`... LIMITED`, `... SECRETARIES LTD`) and resigned officers: no corporate/resigned people become candidates; names split correctly.
- Cron tick fires twice (or overlaps): a lead is never emailed twice (claim-before-send).
- Window edges: start after finish, window crossing local midnight is rejected at setup; DST change day resolves correctly; run started after the finish time sends nothing and reports everything "not reached".
- Lead opted out, blocklisted, deleted, or already contacted between picking and sending: skipped with a reason, never sent.
- Lead has several decision-makers: the email goes to one chosen deterministically (most senior with an email), recorded on the log; if none, the lead's own email; if neither, skipped "no email".
- Draft contains an unfilled `{{placeholder}}`: lead parked as `needs_input` with the draft saved; the run continues.

---

## PIECE 1 — CRO provider and registry-to-lead mapping

### Task 1: Migration 047 (cro provider, registry candidate sources, officer trigger)

**Files:**
- Create: `supabase/migrations/047_registry_officers_cro.sql`
- Modify: `src/types/index.ts` (`DecisionMakerCandidate.source`, `ScrapeSource`, `RawLead.source`)

**Interfaces:**
- Produces: provider value `'cro'`; candidate sources `'companies_house'`, `'cro'`; `raw_leads.raw_data->'officers'` is an array of `{ first_name: string|null, last_name: string|null, title: string|null }`; trigger `leads_copy_registry_officers` copies those into `decision_maker_candidates` when a lead is inserted with a `raw_lead_id`.

- [ ] **Step 1: Write the migration**

```sql
-- 047: CRO key provider, registry decision-maker sources, and officer capture on lead creation.

ALTER TABLE org_api_settings DROP CONSTRAINT org_api_settings_provider_check;
ALTER TABLE org_api_settings ADD CONSTRAINT org_api_settings_provider_check
  CHECK (provider = ANY (ARRAY['gemini','google_places','google_places_pro','companies_house','apollo','hunter','anthropic','opencorporates','cro']));

ALTER TABLE decision_maker_candidates DROP CONSTRAINT decision_maker_candidates_source_check;
ALTER TABLE decision_maker_candidates ADD CONSTRAINT decision_maker_candidates_source_check
  CHECK (source IN ('hunter','apollo','companies_house','cro'));

-- Registry scrapes store each company's people in raw_leads.raw_data.officers. Candidates are
-- service-role-write-only, and approval happens in the browser, so a SECURITY DEFINER trigger
-- copies them when the lead is created (covers manual approval and autopilot auto-approve).
CREATE OR REPLACE FUNCTION leads_copy_registry_officers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  raw_src text;
  raw_officers jsonb;
  o jsonb;
BEGIN
  IF NEW.raw_lead_id IS NULL THEN RETURN NEW; END IF;
  SELECT source, raw_data->'officers' INTO raw_src, raw_officers FROM raw_leads WHERE id = NEW.raw_lead_id;
  IF raw_src NOT IN ('companies_house','cro') OR raw_officers IS NULL OR jsonb_typeof(raw_officers) <> 'array' THEN
    RETURN NEW;
  END IF;
  FOR o IN SELECT * FROM jsonb_array_elements(raw_officers) LOOP
    INSERT INTO decision_maker_candidates (lead_id, source, first_name, last_name, title, created_by)
    VALUES (NEW.id, raw_src, o->>'first_name', o->>'last_name', o->>'title', NEW.created_by)
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS leads_copy_registry_officers ON leads;
CREATE TRIGGER leads_copy_registry_officers AFTER INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_copy_registry_officers();
```

- [ ] **Step 2:** Before applying, read `039_multiple_decision_makers.sql` and confirm the `dedupe_key` generated column and `ON CONFLICT DO NOTHING` target work for rows with no `apollo_person_id`/`email` (key falls back to `id::text`, so every row is unique). Adjust the insert if the unique index requires it.
- [ ] **Step 3:** Apply with the Supabase MCP `apply_migration` (name `registry_officers_cro`). Verify with `execute_sql`: `select conname from pg_constraint where conname in ('org_api_settings_provider_check','decision_maker_candidates_source_check')` and `select tgname from pg_trigger where tgname='leads_copy_registry_officers'`.
- [ ] **Step 4:** In `src/types/index.ts` widen `DecisionMakerCandidate.source` to `'hunter' | 'apollo' | 'companies_house' | 'cro'`, `ScrapeSource` and `RawLead.source` to include `'cro'`; run `npx tsc --noEmit` and fix any exhaustive-switch fallout.
- [ ] **Step 5:** Commit `feat: migration 047 cro provider, registry officer candidates`.

### Task 2: Officer mapping (pure) with tests

**Files:**
- Create: `supabase/functions/_shared/registryOfficers.ts`
- Test: `src/lib/registryOfficers.test.ts`

**Interfaces:**
- Produces: `interface RegistryOfficer { first_name: string | null; last_name: string | null; title: string | null }`; `splitOfficerName(raw: string): { first_name: string | null; last_name: string | null }`; `officerTitle(role: string | undefined): string | null`; `mapCompaniesHouseOfficers(items: { name?: string; officer_role?: string; resigned_on?: string }[], max?: number): RegistryOfficer[]` (active people only, directors first, default `max` 5).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { mapCompaniesHouseOfficers, officerTitle, splitOfficerName } from '../../supabase/functions/_shared/registryOfficers';

describe('splitOfficerName', () => {
  it('handles "SURNAME, Forename Middle"', () => {
    expect(splitOfficerName('SMITH, John Paul')).toEqual({ first_name: 'John', last_name: 'Smith' });
  });
  it('handles plain "Forename Surname"', () => {
    expect(splitOfficerName('Aoife Murphy')).toEqual({ first_name: 'Aoife', last_name: 'Murphy' });
  });
  it('handles a single token', () => {
    expect(splitOfficerName('Madonna')).toEqual({ first_name: 'Madonna', last_name: null });
  });
});

describe('officerTitle', () => {
  it('maps roles to readable titles', () => {
    expect(officerTitle('director')).toBe('Director');
    expect(officerTitle('secretary')).toBe('Company Secretary');
    expect(officerTitle('llp-member')).toBe('Llp Member');
    expect(officerTitle(undefined)).toBeNull();
  });
});

describe('mapCompaniesHouseOfficers', () => {
  it('drops resigned and corporate officers, directors first, capped', () => {
    const out = mapCompaniesHouseOfficers([
      { name: 'ACME SECRETARIES LIMITED', officer_role: 'corporate-secretary' },
      { name: 'JONES, Mary', officer_role: 'secretary' },
      { name: 'SMITH, John', officer_role: 'director' },
      { name: 'OLD, Bob', officer_role: 'director', resigned_on: '2020-01-01' },
    ]);
    expect(out.map((o) => o.first_name)).toEqual(['John', 'Mary']);
    expect(out[0]).toEqual({ first_name: 'John', last_name: 'Smith', title: 'Director' });
  });
  it('returns an empty array for no officers', () => {
    expect(mapCompaniesHouseOfficers([])).toEqual([]);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/registryOfficers.test.ts`, expect FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
export interface RegistryOfficer { first_name: string | null; last_name: string | null; title: string | null }

const CORPORATE = /\b(ltd|limited|llp|plc|secretaries|nominees|nominee|services|holdings|trustees)\b/i;

function titleCase(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
}

/** Splits "SURNAME, Forename Middle" (registry style) or "Forename Surname" into first and last name. */
export function splitOfficerName(raw: string): { first_name: string | null; last_name: string | null } {
  const name = raw.trim();
  if (!name) return { first_name: null, last_name: null };
  const comma = name.indexOf(',');
  if (comma !== -1) {
    const surname = name.slice(0, comma).trim();
    const forenames = name.slice(comma + 1).trim().split(/\s+/).filter(Boolean);
    return { first_name: forenames[0] ? titleCase(forenames[0]) : null, last_name: surname ? titleCase(surname) : null };
  }
  const parts = name.split(/\s+/);
  return { first_name: titleCase(parts[0]!), last_name: parts.length > 1 ? parts.slice(1).map(titleCase).join(' ') : null };
}

/** "director" -> "Director", "secretary" -> "Company Secretary", "llp-member" -> "Llp Member". */
export function officerTitle(role: string | undefined): string | null {
  if (!role) return null;
  if (role === 'secretary') return 'Company Secretary';
  return role.split('-').map(titleCase).join(' ');
}

/** Active, non-corporate officers as decision-maker candidates: directors first, at most `max`. */
export function mapCompaniesHouseOfficers(
  items: { name?: string; officer_role?: string; resigned_on?: string }[],
  max = 5,
): RegistryOfficer[] {
  const people = items.filter((i) => i.name && !i.resigned_on && !CORPORATE.test(i.name) && !(i.officer_role ?? '').startsWith('corporate'));
  people.sort((a, b) => Number(b.officer_role === 'director') - Number(a.officer_role === 'director'));
  return people.slice(0, max).map((i) => ({ ...splitOfficerName(i.name!), title: officerTitle(i.officer_role) }));
}
```

- [ ] **Step 4:** Run the test, expect PASS; run `npx tsc --noEmit` (if tsc rejects importing outside `src`, switch the test to import via a copy under `src/lib/` and add a sync comment, as `templateVars` does).
- [ ] **Step 5:** Commit `feat: registry officer mapping`.

### Task 3: Companies House scraper stores officers and looks up company contacts

**Files:**
- Modify: `supabase/functions/_shared/companiesHouse.ts` (add `fetchActiveOfficers(companyNumber, apiKey): Promise<RegistryOfficer[]>`; keep `fetchFirstOfficer` for existing callers)
- Create: `supabase/functions/_shared/registryContacts.ts` (company contact waterfall)
- Modify: `supabase/functions/scrape-companies-house/index.ts`

**Interfaces:**
- Consumes: `mapCompaniesHouseOfficers` (Task 2); the Google Places website/phone lookup and `scrapeWebsiteContact` that `enrich-leads-bulk/index.ts` `enrichOneLead` already uses (read it, steps 1 to 2, and import the same helpers; do not duplicate them).
- Produces: `lookupCompanyContacts(input: { business_name: string; city: string | null }, keys: { googlePlaces: string | null }): Promise<{ website: string | null; email: string | null; phone: string | null }>` in `registryContacts.ts` (never throws; all null on failure). `raw_leads` rows now carry `website`, `email`, `phone` when found and `raw_data.officers`.

- [ ] **Step 1:** Read `enrich-leads-bulk/index.ts` `enrichOneLead` and `_shared/websiteContact.ts`; extract nothing yet, just identify the exact exports to reuse.
- [ ] **Step 2:** Add `fetchActiveOfficers` to `companiesHouse.ts` (same fetch as `fetchFirstOfficer` but returns `mapCompaniesHouseOfficers(data.items ?? [])`; `[]` on any error).
- [ ] **Step 3:** Implement `lookupCompanyContacts` in `registryContacts.ts`: Places text search `"{business_name} {city}"` for website/phone when a Places key exists (reuse the existing helper), then `scrapeWebsiteContact(website)` for email/phone; return found values only.
- [ ] **Step 4:** In `scrape-companies-house/index.ts`, replace the `fetchFirstOfficer` call with `fetchActiveOfficers` (still `runBounded(companies, 5, ...)`), resolve the org's Places key via `resolveOrgApiKey(service, orgId, 'google_places')`, run `lookupCompanyContacts` in the same bounded pass (limit 5), and write: `owner_name` = first officer's `${first_name} ${last_name}` (kept for backward compatibility), `website/email/phone` from the lookup, `raw_data: { company: c, officers }`.
- [ ] **Step 5:** Syntax-check the three files (command in Global Constraints). Deploy `scrape-companies-house`.
- [ ] **Step 6:** Verify with the Supabase MCP: create a throwaway scrape via a signed-in session only if a Companies House key exists for a test org; otherwise confirm the code path with a direct unit invocation of `mapCompaniesHouseOfficers` (Task 2 tests) and record that live verification is pending a key. Commit `feat: companies house scraper stores officers and company contacts`.

### Task 4: CRO provider, client and scraper source

**Files:**
- Create: `supabase/functions/_shared/cro.ts`, `supabase/functions/scrape-cro/index.ts`
- Test: `src/lib/cro.test.ts`
- Modify: `supabase/functions/_shared/orgApiKeys.ts` (add `'cro'` to `ApiProvider` and `GLOBAL_ENV_VARS` as `CRO_API_KEY`, never set globally so no fallback), `supabase/functions/org-api-settings/index.ts` (provider type, allowed list, `validateKey`), `src/hooks/useOrgApiSettings.ts` (provider union), `src/pages/OrganizationSettings.tsx` (`PROVIDERS` entry with guided steps), `src/pages/Scraper.tsx` (source option), `supabase/functions/run-autopilot/index.ts` (cancel `cro` like `companies_house`)

**Interfaces:**
- Produces: `interface CroCompany { company_number: string; name: string; address: string | null; status: string | null; eircode: string | null }`; `parseCroCompanies(payload: unknown): CroCompany[]` (tolerant, pure); `searchCroCompanies(query: string, cap: number, creds: { email: string; apiKey: string }): Promise<CroCompany[]>`. The CRO key is stored as a single Vault string `email:apiKey` (the guided UI explains this) so the existing single-secret storage needs no change.

- [ ] **Step 1: Write the failing test** `src/lib/cro.test.ts` with a fixture matching CRO's Open Services company search shape (`company_num`, `company_name`, `company_address_1..4`, `company_status_desc`, `eircode`), asserting `parseCroCompanies` maps fields, joins address lines, tolerates missing fields and non-array input (returns `[]`).

```ts
import { describe, expect, it } from 'vitest';
import { parseCroCompanies } from '../../supabase/functions/_shared/cro';

describe('parseCroCompanies', () => {
  it('maps CRO search rows', () => {
    const out = parseCroCompanies([{ company_num: 123456, company_name: 'ACME LIMITED', company_address_1: '1 Main St', company_address_2: 'Dublin', company_status_desc: 'Normal', eircode: 'D01 X2Y3' }]);
    expect(out).toEqual([{ company_number: '123456', name: 'ACME LIMITED', address: '1 Main St, Dublin', status: 'Normal', eircode: 'D01 X2Y3' }]);
  });
  it('is tolerant of junk', () => {
    expect(parseCroCompanies(null)).toEqual([]);
    expect(parseCroCompanies([{}])).toEqual([]);
  });
});
```

- [ ] **Step 2:** Run it, expect FAIL. Implement `parseCroCompanies` (pure: rows without a name are dropped; `company_num` stringified; address lines 1 to 4 joined with `, `), then `searchCroCompanies` using `fetchWithTimeout` against `https://services.cro.ie/cws/companies?company_name=<q>&company_bus_ind=C&skip=0&max=<cap>&htmlEnc=1` with `Authorization: Basic base64(email:apiKey)` and `Accept: application/json`. **The exact endpoint, auth and field names are unverified (no key yet):** keep them in one constant block at the top of `cro.ts`, and add a comment `// CONFIRM against a live response once the CRO key exists`. Run test, expect PASS.
- [ ] **Step 3:** Provider wiring: add `cro` to the TS unions and the allowed list in `org-api-settings`; `validateKey` for `cro` splits the value on the first `:` (reject with "Enter your CRO email and key as email:key" if no colon) and calls `searchCroCompanies('test', 1, ...)` mapping a non-2xx to `CRO rejected the key (HTTP n)`. Add the `PROVIDERS` entry in `OrganizationSettings.tsx` following the Companies House entry's shape, with `steps` (register on the CRO Open Services site, request an API key, paste as `youremail:key`) and `freeText` stating it is free and covers Irish companies.
- [ ] **Step 4:** `scrape-cro/index.ts`: copy `scrape-companies-house/index.ts`, change the country check to `'IE'` (add `'IE'` to the ICP `country` union in `parse-icp` and `IcpParams` if it is not already representable; if `country` is limited to `GB | US | other`, instead gate on an explicit `source: 'cro'` choice and the org having a CRO key), source strings `'cro'`, key `resolveOrgApiKey(service, orgId, 'cro')`, search `searchCroCompanies`, officers `[]` unless the CRO response includes them (parse defensively; if the API exposes directors, map them through a `mapCroOfficers` added alongside `parseCroCompanies` and tested in the same file), and the same `lookupCompanyContacts` pass. Cap 30.
- [ ] **Step 5:** `Scraper.tsx`: add a CRO radio next to Companies House (enabled when the org has a configured `cro` setting, same pattern as `chConfigured`), and send source `cro` to `scrape-cro`. `run-autopilot`: extend the existing "source not supported" cancel to `cro`.
- [ ] **Step 6:** `npx tsc --noEmit`, `npx vitest run`, `npm run build`; syntax-check and deploy `scrape-cro`, `org-api-settings`, `run-autopilot`. Commit `feat: CRO provider, key setup and Irish company scraper`.
- [ ] **Step 7 (user, later):** when Valentina's key exists, save it in UX Tree's org settings, run one Irish search, and compare the live response with the fixture; fix `cro.ts` constants/field names if they differ.

### Task 5: Decision-makers card shows registry people; registry docs

**Files:**
- Modify: `src/components/pipeline/DecisionMakersCard.tsx` (only if it hard-codes source labels; show registry source as "Companies House"/"CRO" and a "no contact found yet" hint when a candidate has no email/phone, with the existing "Find decision maker" action to look them up)
- Modify: `CLAUDE.md` (Piece 1 summary)

- [ ] **Step 1:** Read `DecisionMakersCard.tsx`; grep for `source ===`/`'hunter'`/`'apollo'` across `src/` and fix any narrow handling so `companies_house`/`cro` rows render (name, title, hint), never crash.
- [ ] **Step 2:** `npx tsc --noEmit`, `npx vitest run`, `npm run build`. Add the CLAUDE.md note. Commit `feat: show registry decision-makers` and push.

---

## PIECE 2 — Selected-leads data model, eligibility, picker

### Task 6: Migration 048 (autopilot selected mode, run leads)

**Files:**
- Create: `supabase/migrations/048_autopilot_selected_leads.sql`
- Modify: `src/types/index.ts` (`AutopilotRun` new fields, new `AutopilotRunLead`)

**Interfaces:**
- Produces: `autopilot_runs.mode` (`'discover' | 'selected'`), `window_start`/`window_end` (`TEXT 'HH:MM'`), `timezone` (`TEXT`), `window_date` (`DATE`), `daily_send_cap` (`INT`), table `autopilot_run_leads`.

- [ ] **Step 1: Write the migration** (first read `006_outreach_automation.sql` lines for `autopilot_runs` RLS policy and the `autopilot_runs_one_active_per_org` index, and copy the policy shape exactly, including the null-owner allowance from migration 009 if present):

```sql
ALTER TABLE autopilot_runs
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'discover' CHECK (mode IN ('discover','selected')),
  ADD COLUMN window_start TEXT, ADD COLUMN window_end TEXT, ADD COLUMN timezone TEXT,
  ADD COLUMN window_date DATE, ADD COLUMN daily_send_cap INT;

DROP INDEX autopilot_runs_one_active_per_org;
CREATE UNIQUE INDEX autopilot_runs_one_active_per_org_mode ON autopilot_runs(org_id, mode) WHERE status = 'active';

CREATE TABLE autopilot_run_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','working','sent','skipped','needs_input','failed','not_reached')),
  reason TEXT,
  email_log_id UUID REFERENCES email_logs(id) ON DELETE SET NULL,
  sequence_id UUID REFERENCES email_sequences(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, lead_id)
);
CREATE INDEX idx_autopilot_run_leads_run ON autopilot_run_leads(run_id, status);
ALTER TABLE autopilot_run_leads ENABLE ROW LEVEL SECURITY;
-- Same org-member policy shape as autopilot_runs (copy it from migration 006/009).
CREATE POLICY "autopilot_run_leads_org_member" ON autopilot_run_leads FOR ALL
  USING (EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = autopilot_run_leads.org_id AND m.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = autopilot_run_leads.org_id AND m.user_id = auth.uid()));
ALTER PUBLICATION supabase_realtime ADD TABLE autopilot_run_leads;
```

- [ ] **Step 2:** Existing `autopilot_runs` columns `icp_raw_input`, `icp_params`, `source`, `daily_lead_target`, `duration_days` are NOT NULL for discover runs: check which are NOT NULL and relax only those a selected run cannot supply (give them defaults or drop NOT NULL) in this same migration.
- [ ] **Step 3:** Apply via MCP; verify the index, table, policy, and publication with `execute_sql`. Update `AutopilotRun`/add `AutopilotRunLead` types. `npx tsc --noEmit`. Commit `feat: migration 048 selected-leads autopilot`.

### Task 7: Eligibility and window maths (pure) with tests

**Files:**
- Create: `supabase/functions/_shared/autopilotEligibility.ts`
- Test: `src/lib/autopilotEligibility.test.ts`

**Interfaces:**
- Produces:

```ts
export interface EligibilityLead { id: string; opted_out: boolean; email: string | null; stage: string; last_contacted_at: string | null }
export interface EligibilityEnrollment { status: 'active' | 'paused' | 'completed' | 'cancelled'; next_send_at: string | null }
export type EligibilityResult =
  | { eligible: true; reason: 'new' | 'due' }
  | { eligible: false; reason: 'opted_out' | 'blocked' | 'closed' | 'paused' | 'not_due' | 'recently_contacted' };
export const RECENT_CONTACT_DAYS = 14;
export function classifyLead(lead: EligibilityLead, enrollment: EligibilityEnrollment | null, blocked: Set<string>, endOfToday: Date, now: Date): EligibilityResult;
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date;
export function windowBounds(dateStr: string, start: string, end: string, timeZone: string): { startUtc: Date; endUtc: Date } | null;
export function inWindow(now: Date, bounds: { startUtc: Date; endUtc: Date }): boolean;
export function findUnfilledPlaceholders(text: string): string[];
```

- [ ] **Step 1: Write failing tests** covering: opted-out, blocklisted (exact email and domain), stage `won`/`lost` => `closed`; active enrolment due before end of today => `due`; active enrolment due tomorrow => `not_due`; paused enrolment => `paused`; no enrolment + never contacted => `new`; no enrolment + contacted 3 days ago => `recently_contacted`; contacted 30 days ago => `new`; `zonedTimeToUtc('2026-07-01','09:00','Europe/London')` = `2026-07-01T08:00:00.000Z`; `('2026-01-15','09:00','Europe/London')` = `2026-01-15T09:00:00.000Z`; DST day `('2026-03-29','09:00','Europe/London')` = `08:00Z` (BST starts 01:00); `windowBounds` returns `null` when end <= start; `inWindow` boundaries inclusive start, exclusive end; `findUnfilledPlaceholders('Hi {{first_name}} and {{ pain_point }}')` returns both names, and `[]` for clean text.
- [ ] **Step 2:** Run, expect FAIL. Implement. Core pieces:

```ts
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  const first = guess - tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - tzOffsetMs(new Date(first), timeZone));
}

export function findUnfilledPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!);
}
```

`classifyLead` order: opted_out, closed (`won`/`lost`), blocked (email lower-cased or its domain in the set), enrolment `paused` => paused, enrolment `active` => due if `next_send_at <= endOfToday` else not_due, no active enrolment: `last_contacted_at` within `RECENT_CONTACT_DAYS` of `now` => recently_contacted, else new. (A lead with no email is still eligible here; the engine decides.)
- [ ] **Step 3:** Run tests, expect PASS; `npx tsc --noEmit`. Commit `feat: autopilot eligibility and window maths`.

### Task 8: Selected-leads picker and setup mode

**Files:**
- Create: `src/hooks/useSelectableLeads.ts`, `src/components/autopilot/SelectedLeadsPicker.tsx`, `src/components/autopilot/WindowFields.tsx`
- Modify: `src/pages/AutopilotSetup.tsx`

**Interfaces:**
- Consumes: `classifyLead`, `zonedTimeToUtc`, `windowBounds` (Task 7), `usePipeline`, `useOrg`.
- Produces: `useSelectableLeads(): { loading; error; byPipeline: { pipelineId: string; pipelineName: string; eligible: (Lead & { reason: 'new' | 'due' })[]; hiddenCount: number }[] }`; `SelectedLeadsPicker({ value: Set<string>; onChange })`; setup submit inserts an `autopilot_runs` row (`mode: 'selected'`, window fields, `window_date` = today in the chosen timezone, `daily_send_cap`, `max_total_spend_cents`) plus one `autopilot_run_leads` row per selected lead (status `queued`), then invokes `run-selected-autopilot` with `{ action: 'start', run_id }` (Task 13).

- [ ] **Step 1:** `useSelectableLeads`: load the org's pipelines' leads (RLS-scoped, `useOrgLeads` pattern), their active/paused enrolments, and `outreach_blocklist` for the org; classify each with `classifyLead`; group by pipeline; hide ineligible ones, counting them in `hiddenCount`. No leads without an email are dropped here.
- [ ] **Step 2:** `SelectedLeadsPicker.tsx` (keep under 150 lines; split a `PipelineSection` subcomponent if needed): one card per pipeline with a "Select all" checkbox (indeterminate when partial), a checklist (business name, stage, "due today"/"new" badge, "no email yet" hint), and the "N hidden (contacted recently or not due)" line; loading, error and empty states.
- [ ] **Step 3:** `WindowFields.tsx`: start time, finish time (`<input type="time">`), timezone select defaulting to `Intl.DateTimeFormat().resolvedOptions().timeZone`, daily send cap, spend cap (reuse the existing autopilot cap inputs' labels). Validate with `windowBounds` (must return non-null; show "Finish time must be after start time").
- [ ] **Step 3b:** `AutopilotSetup.tsx`: add a mode switch at the top ("Find new leads" / "Selected leads"); in `selected` mode render the picker and window fields instead of the ICP/source fields; the submit button is disabled until at least one lead is selected and the window is valid. Create the run and run leads, then navigate to the status page.
- [ ] **Step 4:** `npx tsc --noEmit`, `npx vitest run`, `npm run build`. Commit `feat: selected-leads autopilot setup and picker`.

---

## PIECE 3 — Per-lead research

### Task 9: Research module

**Files:**
- Create: `supabase/functions/_shared/leadResearch.ts` (orchestration), `supabase/functions/_shared/researchPages.ts` (pure helpers)
- Modify: `supabase/functions/_shared/ai.ts` (add `geminiGroundedSearch`)
- Test: `src/lib/researchPages.test.ts`

**Interfaces:**
- Produces (pure): `pickResearchLinks(baseUrl: string, hrefs: string[], max?: number): string[]` (same-origin links whose path contains `about|team|service|product|news|blog|contact|people|who-we-are`, deduplicated, homepage excluded, default `max` 4); `stripToText(html: string, maxChars = 6000): string`; `formatResearchNote(parts: { website: string | null; web: string | null; sources: string[] }): string`.
- Produces (orchestration): `researchLead(input: { service; lead: Record<string, unknown>; notes: string[]; orgId: string; geminiKey: string | null }): Promise<{ summary: string; sources: string[]; costCents: number }>` (never throws; on total failure returns an empty summary).
- `geminiGroundedSearch(prompt: string, apiKey: string): Promise<{ text: string; sources: string[] }>`: POST `generateContent` with `tools: [{ google_search: {} }]` using `AI_MODEL`; text from the first part; sources from `groundingMetadata.groundingChunks[].web.uri`.

- [ ] **Step 1: Write failing tests** for `pickResearchLinks` (keeps `/about-us`, `/our-team`, drops other origins, drops `mailto:`, drops duplicates, respects `max`), `stripToText` (removes `<script>`/`<style>`, collapses whitespace, truncates), and `formatResearchNote` (lists sources, omits empty sections).
- [ ] **Step 2:** Run, expect FAIL; implement the three pure helpers; run, expect PASS.
- [ ] **Step 3:** Implement `geminiGroundedSearch` in `ai.ts` and `researchLead`: fetch the homepage via the existing SSRF-guarded fetch in `websiteContact.ts` (`parseSafeWebsiteUrl` first, `fetchWithTimeout`), collect `href`s, fetch up to 4 `pickResearchLinks` pages in parallel, `stripToText` each, then one Gemini grounded query ("Recent news, LinkedIn presence, reviews and what {business} does, UK English, cite sources") plus one Sonnet-free summarising pass done by Gemini over the combined text into 4 to 6 bullet talking points. Save nothing here; return the summary. `costCents` is a fixed estimate constant per lead (`RESEARCH_COST_CENTS = 3`) added to the run's spend counter by the engine.
- [ ] **Step 4:** Syntax-check the three files; `npx vitest run`. Commit `feat: lead research module`.

---

## PIECE 4 — Engine: draft, send, platform updates

### Task 10: Shared send helper extracted from send-email

**Files:**
- Create: `supabase/functions/_shared/sendLeadEmail.ts`
- Modify: `supabase/functions/send-email/index.ts` (call the helper; behavior unchanged)

**Interfaces:**
- Produces: `sendLeadEmail(service, input: { senderId: string; to: string; subject: string; body: string; leadId: string; logId?: string | null; decisionMakerCandidateId?: string | null; attachments?: unknown }): Promise<{ ok: true; logId: string } | { ok: false; error: string }>` which loads the sender's `user_email_settings` and Vault password, sends via `_shared/smtp.ts` `sendMail`, writes or updates the `email_logs` row (`status: 'sent'`, `sent_at`, `sent_by: senderId`), updates `leads.last_contacted_at`, and advances `new_lead` to `contacted` only.

- [ ] **Step 1:** Read all of `send-email/index.ts`. Move the post-auth body (settings gate, SMTP send, attachment handling, log write, lead updates) into `sendLeadEmail`, keeping every existing check (verified settings, stored password, org membership stays in the HTTP handler because it uses the caller's identity). The HTTP handler keeps auth + membership + draft-ownership checks and delegates.
- [ ] **Step 2:** Syntax-check both files, deploy `send-email`, and verify live that sending a draft from the UI still works (send one email to the user's own address) and that `last_contacted_at` updates. Commit `refactor: extract sendLeadEmail from send-email`.

### Task 11: Sequence choice and recipient choice (pure) with tests

**Files:**
- Create: `supabase/functions/_shared/autopilotChoices.ts`
- Test: `src/lib/autopilotChoices.test.ts`

**Interfaces:**
- Produces: `pickSequence(input: { enrolledSequenceId: string | null; aiPickedId: string | null; icpId: string | null; sequences: { id: string; icp_id: string | null }[] }): string | null` (enrolled wins; else AI pick if it is a real id in `sequences`; else the first sequence whose `icp_id` equals the lead's `icpId`; else `null`); `pickRecipient(leadEmail: string | null, candidates: { id: string; title: string | null; email: string | null }[]): { email: string; candidateId: string | null } | null` (candidates with an email ranked by seniority regex `/(owner|founder|managing director|ceo|director|head|manager)/i` then input order; falls back to the lead email; `null` if nothing).

- [ ] **Step 1:** Write tests for every branch above (including an AI pick that is not in the list being ignored, and no candidates with email falling back to the lead email, and both missing returning `null`). Run, expect FAIL.
- [ ] **Step 2:** Implement; run, expect PASS. Commit `feat: autopilot sequence and recipient choice`.

### Task 12: Migration 049 (cron) and engine function

**Files:**
- Create: `supabase/migrations/049_selected_autopilot_cron.sql`, `supabase/functions/run-selected-autopilot/index.ts`

**Interfaces:**
- Consumes: Tasks 7, 9, 10, 11; `check-sequences` for the exact notes-then-draft calls (`generateLeadNotes`, `draftEmailClaude`, template resolution, `buildTemplateVars`/`substituteVariables`, `loadCustomVariables`, ICP loading) — read its draft path and reuse the same helpers rather than re-implementing; `advanceEnrollment`/`nextSendAtFor` logic mirrored from `src/lib/sequenceMath.ts` (already duplicated as `advance` in `check-sequences`).
- Produces: `POST /functions/v1/run-selected-autopilot` with body `{ action: 'start', run_id }` (user JWT + org membership, verifies the run's `created_by` is the caller or they are an org admin) or `{ action: 'tick' }` (header `x-cron-secret`).

- [ ] **Step 1: Cron migration.** Copy the `cron.schedule('run-autopilot-daily', ...)` call shape from migration 006 (read it: vault secret name, URL, headers) and schedule `run-selected-autopilot-tick` every 5 minutes (`'*/5 * * * *'`) POSTing `{"action":"tick"}`. Apply via MCP.
- [ ] **Step 2: Skeleton.** CORS/OPTIONS, `start` path (auth via anon client `getUser`, run lookup via service client, membership check, then run `processRun` once), `tick` path (cron-secret gate, load runs `status='active' AND mode='selected'`, `processRun` each).
- [ ] **Step 3: `processRun(run)`.** Compute `bounds = windowBounds(run.window_date, run.window_start, run.window_end, run.timezone)`. If `now > bounds.endUtc`: mark remaining `queued` rows `not_reached` ("Finish time reached"), set run `completed`, return. If `now < bounds.startUtc`: return (nothing to do yet). Else take up to 3 `queued` rows, claim each atomically: `update autopilot_run_leads set status='working', claimed_at=now() where id=$1 and status='queued' returning *` (skip if no row returned, which prevents double-send across overlapping ticks). Also reset rows stuck `working` for over 10 minutes back to `queued` at the start of each tick.
- [ ] **Step 4: `processLead(run, row)`**, wrapped in try/catch so any throw marks that row `failed` with the message and returns:
  1. Reload the lead via the service client **and verify `lead.org_id === run.org_id`** (else `skipped`, "Lead no longer in this organization"); deleted lead => `skipped`.
  2. Re-run `classifyLead` with the current enrolment and blocklist; ineligible => `skipped` with a plain-English reason (opted out, blocked, contacted recently, not due, paused, closed).
  3. Caps: if `run.outreach_sent_total >= run.daily_send_cap` or `run.actual_ai_cost_cents >= run.max_total_spend_cents` (when set): set the row back to `queued`, complete the run with `cancel_reason` "Daily send cap reached"/"Spend cap reached", stop.
  4. Missing email: invoke the same enrichment code path as `enrich-leads-bulk` for this single lead and apply found values (reuse the exported `enrichOneLead` if exported; otherwise move it to `_shared/enrichLead.ts` as part of this task), then, if still no email, run the decision-maker search logic from `find-decision-makers` (also factor its core into `_shared/` if it is inline). Still no email after both => `skipped`, "No email found even after looking up details and decision-makers".
  5. `pickRecipient` (reload candidates after step 4). None => `skipped` as above.
  6. `researchLead(...)`; insert an `ai_summary` `lead_notes` row (`created_by: run.created_by`) with `formatResearchNote(...)`; add `RESEARCH_COST_CENTS` to the run's `actual_ai_cost_cents`.
  7. Choose the sequence with `pickSequence` (`aiPickedId` from one cheap Haiku call listing sequence ids+names and returning JSON `{ "sequence_id": string | null }`, validated by `pickSequence`). `null` => `needs_input`, "No suitable sequence for this lead".
  8. Pick the step: enrolled => its `current_step`; new => step 1. Resolve template exactly as `check-sequences` does; draft with notes-then-draft (research note as notes); `stripAiPunctuation` already applies.
  9. `findUnfilledPlaceholders(subject + body)` non-empty => insert the draft as an `email_logs` row `status: 'draft'`, `sent_by: run.created_by`, set row `needs_input` with reason "Draft has an unfilled placeholder: {{x}}" and `email_log_id`; continue.
  10. Send: `sendLeadEmail(service, { senderId: run.created_by, ... })`. `{ ok:false }` => `failed` with the error.
  11. Platform updates after a successful send: `lead_notes` row "Autopilot sent email: {subject}" (`note_type: 'general'`); enrol (`insert sequence_enrollments { lead_id, sequence_id, current_step, next_send_at, status:'active', enrolled_by: run.created_by }`) or advance the existing enrolment via the engine's `advance()` (completing it when past the last step); set the lead's `next_action_date` to the next step's `next_send_at` date and `next_action_note` "Follow up: step N of the sequence" (skip when the sequence completed); `outreach_sent_total += 1`; row `sent` with `email_log_id`, `sequence_id`.
  12. After each lead, wait `SEND_GAP_MS = 20000` only if more rows remain this tick and time budget allows (the function has a 150s wall clock; process at most 3 leads per tick).
- [ ] **Step 5:** When no `queued`/`working` rows remain, mark the run `completed`.
- [ ] **Step 6:** Syntax-check; deploy `run-selected-autopilot`. Live verify with a throwaway org (create via `execute_sql` as in previous cycles' Task 12 pattern, user JWT minted for it) with 2 leads addressed to the user's own mailbox: a normal lead, and a lead with a deliberately unfillable placeholder in its template; confirm one `sent` (with note, stage `contacted`, enrolment, next_action_date) and one `needs_input`, and that calling `tick` twice quickly sends only once. Clean up all throwaway rows afterwards and confirm real counts unchanged. Commit `feat: selected-leads autopilot engine`.

---

## PIECE 5 — Status page and Needs-your-input queue

### Task 13: Status view for selected runs

**Files:**
- Create: `src/hooks/useAutopilotRunLeads.ts`, `src/components/autopilot/RunLeadGroups.tsx`
- Modify: `src/pages/AutopilotStatus.tsx`

**Interfaces:**
- Produces: `useAutopilotRunLeads(runId: string): { rows: (AutopilotRunLead & { lead: { id: string; business_name: string } | null })[]; loading; error }` with a realtime subscription on `autopilot_run_leads` filtered by `run_id`.

- [ ] **Step 1:** Hook (initial select with `lead:leads(id, business_name)` + realtime refetch, following `useScrapeJob`'s subscription pattern).
- [ ] **Step 2:** `RunLeadGroups.tsx`: groups Sent / Needs your input / Skipped / Not reached / Failed / Still queued, each row showing business name and plain-English reason, loading/error/empty states, counts in group headings.
- [ ] **Step 3:** `AutopilotStatus.tsx`: when `run.mode === 'selected'` render the window (local times), sent/cap counters and `RunLeadGroups` instead of the discover counters; keep the existing view for discover runs.
- [ ] **Step 4:** `npx tsc --noEmit`, `npx vitest run`, `npm run build`. Commit `feat: selected-leads autopilot status page`.

### Task 14: Needs-your-input queue and visibility

**Files:**
- Create: `src/components/autopilot/NeedsInputRow.tsx`
- Modify: `src/components/autopilot/RunLeadGroups.tsx`, the Dashboard "ready to review" area (read `src/pages/Dashboard.tsx` and `src/components/dashboard/*` to match), `src/pages/Emails.tsx` or its hub for a count badge

**Interfaces:**
- Consumes: the saved draft `email_logs` row (`email_log_id`) for `needs_input` rows.

- [ ] **Step 1:** `NeedsInputRow`: shows the reason, opens the draft in the existing composer/review editor (reuse `EmailReviewQueue`'s edit-and-send action), and after the user sends it, updates the run lead row to `sent` (client update; RLS permits org members) and runs the same platform updates the user would get from the normal send path (the shared `send-email` already updates last-contacted and stage; add the note and enrolment advance by invoking a small helper or leaving enrolment as the engine set it, as chosen when implementing Task 12 step 11 for `needs_input` leads: enrol at step 1 only after the manual send, so do it here via `useEnrollments(leadId).enroll(sequenceId)` using the row's `sequence_id`).
- [ ] **Step 2:** Add a count of `needs_input` rows (org-scoped) to the Dashboard summary and as a badge on the Emails nav entry; empty state hides them.
- [ ] **Step 3:** `npx tsc --noEmit`, `npx vitest run`, `npm run build`; manually verify in the browser against the throwaway data from Task 12 (or a fresh one). Commit `feat: needs-your-input queue for autopilot`.

### Task 15: Documentation and final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** Add a CLAUDE.md entry covering: registry officers as candidates (trigger), CRO provider and its unverified-endpoint note, selected-leads autopilot (tables, cron, engine, claim-before-send, window/timezone handling, needs_input), the shared `sendLeadEmail`, and the "pure modules under `_shared` tested from `src/lib`" convention.
- [ ] **Step 2:** Run the whole suite once more (`npx tsc --noEmit`, `npx vitest run`, `npm run build`, one at a time). Confirm all edge functions touched are deployed (list: `scrape-companies-house`, `scrape-cro`, `org-api-settings`, `run-autopilot`, `send-email`, `run-selected-autopilot`, plus any function whose helper was factored out). Commit `docs: CLAUDE.md for registry contacts and selected autopilot` and push.

---

## Self-review

- **Spec coverage:** Piece 1 (Tasks 1 to 5) covers CRO provider/source, registry-to-lead plus candidates, company contact lookup, "no contact found" hint, UX Tree setup. Piece 2 (6 to 8) covers modes, per-mode uniqueness, run leads table, eligibility, picker, window. Piece 3 (9) covers research with grounded search and website deep read. Piece 4 (10 to 12) covers send helper, sequence/step/recipient choice, placeholder parking, caps, window, claim-before-send, platform updates. Piece 5 (13 to 14) covers status page, Needs-your-input queue, dashboard/Emails visibility.
- **Known open dependency:** CRO's real response shape and whether it returns directors (Task 4 steps 2, 4 and 7); the plan treats "no officers" as normal.
- **Type consistency:** `RegistryOfficer`, `EligibilityResult`, `pickSequence`/`pickRecipient`, `sendLeadEmail`, `useAutopilotRunLeads` are defined once and used with the same names later.
