# Decision-Maker Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user multi-select leads on the Pipeline list and run a new
"Find decision maker" action that searches Hunter (free, already-revealed
name+email) and Apollo (free search, paid reveal) for a named
owner/founder/C-suite/director at each lead's company, then review and choose
what to add to the lead.

**Architecture:** A new `decision_maker_candidates` table holds one row per
`(lead_id, source)`. `find-decision-makers` (bulk, free) populates it from
Hunter's domain-search and Apollo's people-search. `reveal-decision-maker`
handles the paid, explicit, per-candidate Apollo reveal — email comes back
synchronously and is written straight to the lead; phone is requested via a
webhook and arrives later, handled by a new **public** edge function
(`apollo-phone-webhook`, `verify_jwt: false`) that writes it to both the
candidate row and the lead directly. The frontend adds a third toolbar button
next to "Fill missing details"/"Draft emails", and a new review modal that
subscribes to realtime updates on the candidate rows so a phone number
appears the moment the webhook lands, with no polling and no explicit apply
step for either provider (Hunter's "Add to lead" and Apollo's "Reveal" are
both already-consented, explicit actions — nothing writes silently).

**Tech Stack:** Supabase Edge Functions (Deno), React 18 + TypeScript,
Tailwind, Supabase Realtime, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-decision-maker-enrichment-design.md`

## Global Constraints

- Search (`find-decision-makers`) is entirely free — Hunter's domain-search
  and Apollo's `mixed_people/api_search` cost nothing. Never call Apollo's
  `people/match` (the reveal endpoint) from inside the search path.
- Nothing writes to a lead except through an explicit, already-consented
  per-candidate action: Hunter's "Add to lead" button, or an Apollo "Reveal
  email"/"Reveal phone" click. There is no diff-review/apply step for this
  feature — that pattern belongs to the *other* bulk action
  (`enrich-leads-bulk`/`EnrichmentReview`), which this plan does not modify.
- `decision_maker_candidates` has **no client INSERT/UPDATE policy at all** —
  every write goes through a service-role edge function (search, reveal, or
  the webhook). Only a SELECT policy exists, gated by the existing
  `can_view_lead(lead_id)` function.
- `apollo-phone-webhook` is the only new function with `verify_jwt: false` —
  Apollo cannot send Supabase auth. Its entire trust boundary is the
  `APOLLO_WEBHOOK_SECRET` token embedded in the `webhook_url` query string
  that `reveal-decision-maker` builds. Never skip that check, and never log
  the token value.
- Bulk search batches are capped at 40 leads (`MAX_LEADS = 40`), matching
  `enrich-leads-bulk`'s existing cap.
- Never trust a client-supplied `org_id` — every edge function derives org
  membership from the rows it's given, matching every other function in this
  project.
- **Edge function deploy layout is per-function and must be preserved** for
  any function that already exists. These are all brand-new functions, so
  use the flat `<name>/index.ts` + `_shared/` siblings convention (matching
  `enrich-leads-bulk`, `scrape-companies-house`) unless a task says
  otherwise.
- Supabase project id for all MCP deploy/execute_sql calls:
  `wgomksxelyfkzepbnkdd`.
- This codebase has no Deno-side unit test harness — edge-function logic is
  verified by deploying and invoking it for real (Supabase MCP tools or a
  direct `supabase.functions.invoke`/`curl`), never `.test.ts` files under
  `supabase/functions/`. Frontend behavior is verified live in the browser
  (Chrome MCP tools), not React component tests. No task in this plan needs
  a `src/lib/` pure-function twin — there's no logic here that's both
  genuinely pure and genuinely consumed by a browser-side component the way
  `enrichmentGrouping.ts` was for the other bulk action.
- Mr Brush & Co (org id `0a3d8195-f840-44e3-9b9d-063b22d98b63`) already has
  Companies House, Google Places, Hunter, and Apollo keys configured and
  live-verified this session — use it for every live-verification step in
  this plan unless a task says otherwise.
- **Deviation from the spec's Testing section, deliberate**: the spec
  mentions "unit tests" for the Hunter scoring function and a "component
  test" for `DecisionMakerReview`. Per the no-test-harness constraint above,
  both are replaced with live verification instead (Task 2's curl check,
  Task 9's manual webhook trigger + browser confirmation) — same coverage
  goal, different mechanism, matching how every other edge-function/
  component pair in this codebase is actually verified.

---

### Task 1: `decision_maker_candidates` table, RLS, and realtime

**Files:**
- Create: `supabase/migrations/030_decision_maker_candidates.sql`

**Interfaces:**
- Produces: the `decision_maker_candidates` table (columns: `id, lead_id,
  source, apollo_person_id, first_name, last_name, name_obfuscated, title,
  email, email_revealed, phone, phone_status, applied_at, created_by,
  created_at, updated_at`, `UNIQUE (lead_id, source)`) — consumed by every
  later task in this plan.

- [ ] **Step 1: Write the migration**

`supabase/migrations/030_decision_maker_candidates.sql`:

```sql
-- Tracks decision-maker candidates found via Hunter (free, already-revealed
-- name+email) and Apollo (free search, paid reveal) for the "Find decision
-- maker" Pipeline action. One row per (lead_id, source); re-running search
-- upserts rather than duplicating. All writes go through service-role edge
-- functions (search, reveal, or the Apollo phone webhook) — there is no
-- client INSERT/UPDATE policy, matching scrape_jobs/raw_leads.

CREATE TABLE decision_maker_candidates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source            TEXT NOT NULL CHECK (source IN ('hunter', 'apollo')),
  apollo_person_id  TEXT,
  first_name        TEXT,
  last_name         TEXT,
  name_obfuscated   BOOLEAN NOT NULL DEFAULT false,
  title             TEXT,
  email             TEXT,
  email_revealed    BOOLEAN NOT NULL DEFAULT false,
  phone             TEXT,
  phone_status      TEXT NOT NULL DEFAULT 'not_requested'
                      CHECK (phone_status IN ('not_requested', 'pending', 'revealed', 'not_found', 'failed')),
  applied_at        TIMESTAMPTZ,
  created_by        UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, source)
);

ALTER TABLE decision_maker_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "decision_maker_candidates_view" ON decision_maker_candidates
  FOR SELECT USING (can_view_lead(lead_id));

ALTER PUBLICATION supabase_realtime ADD TABLE decision_maker_candidates;
```

- [ ] **Step 2: Apply it**

Use `mcp__plugin_supabase_supabase__apply_migration` (project id
`wgomksxelyfkzepbnkdd`, name `decision_maker_candidates`).

- [ ] **Step 3: Live-verify RLS and realtime**

Run directly via `mcp__plugin_supabase_supabase__execute_sql`:

```sql
SELECT relrowsecurity FROM pg_class WHERE relname = 'decision_maker_candidates';
-- expect: true

SELECT polname, qual FROM pg_policies WHERE tablename = 'decision_maker_candidates';
-- expect exactly one row: decision_maker_candidates_view, qual mentions can_view_lead

SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'decision_maker_candidates';
-- expect one row
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/030_decision_maker_candidates.sql
git commit -m "feat: add decision_maker_candidates table"
```

---

### Task 2: Hunter decision-maker lookup

**Files:**
- Modify: `supabase/functions/_shared/apolloHunterLookup.ts`

**Interfaces:**
- Produces: `findHunterDecisionMaker(website: string | null, apiKey: string):
  Promise<{ firstName: string | null; lastName: string | null; title: string
  | null; email: string } | null>` — consumed by Task 4's
  `find-decision-makers`.

- [ ] **Step 1: Add the function**

The existing `lookupHunterEmail` in this file keeps only `value`/`confidence`
per email — Hunter's domain-search actually returns `first_name`,
`last_name`, `position`, and `seniority` per email too. Add a new function
alongside it (do not modify `lookupHunterEmail` — it's still used by the
other bulk-enrichment waterfall):

```typescript
const DECISION_MAKER_TITLE_PATTERN = /owner|founder|chief|ceo|coo|cfo|cto|president|managing director|^director$/i;

interface HunterEmailEntry {
  value: string;
  confidence: number;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  seniority?: string | null;
}

export interface HunterDecisionMakerCandidate {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string;
}

/**
 * Hunter domain-search, but scored for "most likely decision-maker" instead
 * of "highest confidence" — prefers seniority: 'executive', then a title
 * matching an owner/founder/C-suite/director pattern, then falls back to
 * confidence. Hunter already includes name+position+seniority per email in
 * this same call (unlike lookupHunterEmail above, which discards them) — no
 * extra request, no extra cost.
 */
export async function findHunterDecisionMaker(website: string | null, apiKey: string): Promise<HunterDecisionMakerCandidate | null> {
  const domain = bareDomain(website ?? '');
  if (!domain) return null;
  try {
    const res = await fetchWithTimeout(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`);
    if (!res.ok) return null;
    const data = await res.json() as { data?: { emails?: HunterEmailEntry[] } };
    const emails = data.data?.emails ?? [];
    if (emails.length === 0) return null;
    const ranked = [...emails].sort((a, b) => {
      const seniorityScore = (e: HunterEmailEntry) => (e.seniority === 'executive' ? 2 : e.seniority === 'senior' ? 1 : 0);
      const titleScore = (e: HunterEmailEntry) => (e.position && DECISION_MAKER_TITLE_PATTERN.test(e.position) ? 1 : 0);
      const aScore = seniorityScore(a) * 10 + titleScore(a) * 5;
      const bScore = seniorityScore(b) * 10 + titleScore(b) * 5;
      if (aScore !== bScore) return bScore - aScore;
      return b.confidence - a.confidence;
    });
    const top = ranked[0]!;
    return { firstName: top.first_name ?? null, lastName: top.last_name ?? null, title: top.position ?? null, email: top.value };
  } catch {
    return null;
  }
}
```

Note: this file doesn't currently import `fetchWithTimeout` (its existing
functions use plain `fetch`) — add the import at the top:
```typescript
import { fetchWithTimeout } from './fetchWithTimeout.ts';
```

- [ ] **Step 2: Live-verify against the real API**

This isn't independently deployable (shared helper) — its first real
exercise is Task 4's end-to-end test. Before that, sanity-check Hunter's
actual response shape hasn't drifted from what's assumed above by running
this directly (Mr Brush & Co's configured Hunter key):

```bash
curl "https://api.hunter.io/v2/domain-search?domain=<a real domain from one of Mr Brush & Co's leads>&api_key=<hunter key>"
```

Confirm each entry under `data.emails[]` has `first_name`, `last_name`,
`position`, `seniority` fields (they may be `null` for some entries — that's
fine and handled by the code above; confirm the *keys* exist in the response
shape, not that every value is populated).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/apolloHunterLookup.ts
git commit -m "feat: add Hunter decision-maker scoring (name+title, not just email)"
```

---

### Task 3: Apollo people-search and reveal helpers

**Files:**
- Create: `supabase/functions/_shared/apolloPeopleSearch.ts`

**Interfaces:**
- Produces: `searchApolloDecisionMaker(domain: string, apiKey: string):
  Promise<ApolloPersonCandidate | null>` and `revealApolloPerson(personId:
  string, apiKey: string, opts: { revealEmail: boolean; revealPhone: boolean;
  webhookUrl?: string }): Promise<ApolloRevealResult | null>` — both consumed
  by Task 4 (`find-decision-makers`, search only) and Task 5
  (`reveal-decision-maker`, reveal only).

- [ ] **Step 1: Write the helper**

`supabase/functions/_shared/apolloPeopleSearch.ts`:

```typescript
// supabase/functions/_shared/apolloPeopleSearch.ts
import { fetchWithTimeout } from './fetchWithTimeout.ts';

const DECISION_MAKER_SENIORITIES = ['owner', 'founder', 'c_suite', 'partner', 'director'];

export interface ApolloPersonCandidate {
  apolloPersonId: string;
  firstName: string | null;
  lastNameObfuscated: string | null;
  title: string | null;
}

/**
 * Apollo's people search (0 credits — confirmed against Apollo's own
 * endpoint-essentials table, 2026-09-24). Returns only an obfuscated last
 * name and title — never contact info, that requires the separate paid
 * revealApolloPerson() call below. per_page: 1 — this feature only ever
 * shows the single best candidate per lead.
 */
export async function searchApolloDecisionMaker(domain: string, apiKey: string): Promise<ApolloPersonCandidate | null> {
  try {
    const params = new URLSearchParams();
    params.append('q_organization_domains_list[]', domain);
    for (const seniority of DECISION_MAKER_SENIORITIES) params.append('person_seniorities[]', seniority);
    params.append('per_page', '1');
    const res = await fetchWithTimeout('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Api-Key': apiKey },
      body: params.toString(),
    });
    if (!res.ok) return null;
    const data = await res.json() as { people?: { id?: string; first_name?: string; last_name_obfuscated?: string; title?: string | null }[] };
    const top = data.people?.[0];
    if (!top?.id) return null;
    return {
      apolloPersonId: top.id,
      firstName: top.first_name ?? null,
      lastNameObfuscated: top.last_name_obfuscated ?? null,
      title: top.title ?? null,
    };
  } catch {
    return null;
  }
}

export interface ApolloRevealResult {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

/**
 * Apollo's people/match with an explicit, already-consented reveal request.
 * Costs real Apollo credits (1 for email/demographics if found, +8 more if
 * a mobile phone is actually returned via the webhook — confirmed against
 * Apollo's docs, 2026-09-24). When revealPhone is true, the phone number is
 * NEVER in this response — it arrives later at webhookUrl. This function
 * only returns the synchronous parts (name, email).
 */
export async function revealApolloPerson(
  personId: string,
  apiKey: string,
  opts: { revealEmail: boolean; revealPhone: boolean; webhookUrl?: string },
): Promise<ApolloRevealResult | null> {
  try {
    const body: Record<string, unknown> = { id: personId };
    if (opts.revealEmail) body.reveal_personal_emails = true;
    if (opts.revealPhone) {
      body.reveal_phone_number = true;
      body.webhook_url = opts.webhookUrl;
    }
    const res = await fetchWithTimeout('https://api.apollo.io/api/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify(body),
    }, 8000);
    if (!res.ok) return null;
    const data = await res.json() as { person?: { first_name?: string; last_name?: string; email?: string } };
    if (!data.person) return null;
    return {
      firstName: data.person.first_name ?? null,
      lastName: data.person.last_name ?? null,
      email: data.person.email ?? null,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Live-verify the search call for real**

Not independently deployable — its first exercise is Task 4. Before that,
confirm the request shape against the real endpoint directly (Mr Brush &
Co's Apollo key), since this endpoint's exact field-array encoding
(`q_organization_domains_list[]`) matters and hasn't been hand-tested yet:

```bash
curl -X POST "https://api.apollo.io/api/v1/mixed_people/api_search" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "X-Api-Key: <apollo key>" \
  --data-urlencode "q_organization_domains_list[]=<a real domain from one of Mr Brush & Co's leads>" \
  --data-urlencode "person_seniorities[]=owner" \
  --data-urlencode "person_seniorities[]=founder" \
  --data-urlencode "person_seniorities[]=c_suite" \
  --data-urlencode "person_seniorities[]=partner" \
  --data-urlencode "person_seniorities[]=director" \
  --data-urlencode "per_page=1"
```

Confirm the response has a `people` array whose entries have `id`,
`first_name`, `last_name_obfuscated`, `title` — if Apollo's real field names
differ from this (e.g. it turns out to require JSON body instead of
form-encoded), fix `apolloPeopleSearch.ts` to match the real shape before
continuing, same discipline as any third-party integration in this codebase.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/apolloPeopleSearch.ts
git commit -m "feat: add Apollo people-search and reveal helpers"
```

---

### Task 4: `find-decision-makers` edge function

**Files:**
- Create: `supabase/functions/find-decision-makers/index.ts`
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: `findHunterDecisionMaker` (Task 2), `searchApolloDecisionMaker`
  (Task 3), `resolveOrgApiKey` (existing `_shared/orgApiKeys.ts`),
  `runBounded` (existing `_shared/concurrency.ts`), `bareDomain` (existing
  `_shared/domain.ts`).
- Produces: the HTTP contract `POST { lead_ids: string[] } → { results:
  Array<{ lead_id: string; candidates: DecisionMakerCandidate[] }> }`, and
  the matching frontend type `DecisionMakerCandidate` in `src/types/index.ts`
  — both consumed by Task 7's `useDecisionMakers` hook and Task 8's
  `DecisionMakerReview` component.

- [ ] **Step 1: Add the frontend type**

In `src/types/index.ts`, add (near `EnrichmentResult`):

```typescript
export interface DecisionMakerCandidate {
  id: string;
  lead_id: string;
  source: 'hunter' | 'apollo';
  apollo_person_id: string | null;
  first_name: string | null;
  last_name: string | null;
  name_obfuscated: boolean;
  title: string | null;
  email: string | null;
  email_revealed: boolean;
  phone: string | null;
  phone_status: 'not_requested' | 'pending' | 'revealed' | 'not_found' | 'failed';
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Write the edge function**

`supabase/functions/find-decision-makers/index.ts`:

```typescript
// supabase/functions/find-decision-makers/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { runBounded } from '../_shared/concurrency.ts';
import { bareDomain } from '../_shared/domain.ts';
import { findHunterDecisionMaker } from '../_shared/apolloHunterLookup.ts';
import { searchApolloDecisionMaker } from '../_shared/apolloPeopleSearch.ts';

const MAX_LEADS = 40;

interface LeadRow { id: string; org_id: string; website: string | null }

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
    .from('leads').select('id, org_id, website').in('id', leadIds);
  if (leadsErr) return json({ error: leadsErr.message }, 500, headers);
  const resolvedLeads = (leads ?? []) as LeadRow[];
  if (resolvedLeads.length === 0) return json({ results: [] }, 200, headers);

  const orgIds = new Set(resolvedLeads.map((l) => l.org_id));
  if (orgIds.size > 1) return json({ error: 'Selected leads span more than one organization' }, 400, headers);
  const orgId = [...orgIds][0]!;
  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const [hunterKey, apolloKey] = await Promise.all([
    resolveOrgApiKey(service, orgId, 'hunter'),
    resolveOrgApiKey(service, orgId, 'apollo'),
  ]);

  const perLead = await runBounded(resolvedLeads, 5, async (lead) => {
    const domain = bareDomain(lead.website ?? '');
    if (!domain) return { lead_id: lead.id, candidates: [] as Record<string, unknown>[] };

    const rows: Record<string, unknown>[] = [];

    if (hunterKey) {
      const hunter = await findHunterDecisionMaker(lead.website, hunterKey);
      if (hunter) {
        rows.push({
          lead_id: lead.id, source: 'hunter',
          first_name: hunter.firstName, last_name: hunter.lastName, title: hunter.title,
          email: hunter.email, email_revealed: true, name_obfuscated: false,
          created_by: userData.user.id,
        });
      }
    }
    if (apolloKey) {
      const apollo = await searchApolloDecisionMaker(domain, apolloKey);
      if (apollo) {
        rows.push({
          lead_id: lead.id, source: 'apollo', apollo_person_id: apollo.apolloPersonId,
          first_name: apollo.firstName, last_name: apollo.lastNameObfuscated, title: apollo.title,
          name_obfuscated: true, email_revealed: false,
          created_by: userData.user.id,
        });
      }
    }

    if (rows.length === 0) return { lead_id: lead.id, candidates: [] as Record<string, unknown>[] };

    // Deliberately omits phone/phone_status/applied_at: PostgREST's upsert
    // only SETs the columns present in the payload, so re-running search on
    // a lead with an in-progress or already-revealed Apollo phone leaves
    // that state untouched instead of resetting it back to defaults.
    const { data: upserted, error: upsertErr } = await service
      .from('decision_maker_candidates')
      .upsert(rows, { onConflict: 'lead_id,source' })
      .select('*');
    if (upsertErr) return { lead_id: lead.id, candidates: [] as Record<string, unknown>[] };
    return { lead_id: lead.id, candidates: upserted ?? [] };
  });

  const results = perLead.filter((r) => r.candidates.length > 0);
  return json({ results }, 200, headers);
});
```

- [ ] **Step 3: Deploy and live-verify end-to-end**

`find-decision-makers` is brand new — `get_edge_function` should find
nothing. Deploy via `deploy_edge_function` with layout
`find-decision-makers/index.ts` + the `_shared/*.ts` files it imports.

Pick 2-3 real leads with real websites from Mr Brush & Co
(`select id, business_name, website from leads where org_id =
'0a3d8195-f840-44e3-9b9d-063b22d98b63' and website is not null limit 3`),
then invoke directly:

```typescript
const { data } = await supabase.functions.invoke('find-decision-makers', {
  body: { lead_ids: ['<id1>', '<id2>', '<id3>'] },
});
console.log(data);
```

Confirm: `results` array has at least one entry with `candidates` containing
a `source: 'hunter'` row with a real (non-null) `email` and `email_revealed:
true`, and/or a `source: 'apollo'` row with `name_obfuscated: true` and a
non-null `apollo_person_id`. Query the table directly to confirm the upsert
actually persisted: `select * from decision_maker_candidates where lead_id =
'<id1>'`. Re-invoke with the same lead ids and confirm row count doesn't
double (upsert, not insert) — same `id` values before and after. Also
confirm the guardrails: 41 fake ids → 400 "Select 40 or fewer"; a
non-member's JWT → 403.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/find-decision-makers/index.ts src/types/index.ts
git commit -m "feat: add find-decision-makers edge function"
```

---

### Task 5: `APOLLO_WEBHOOK_SECRET` + `reveal-decision-maker` edge function

**Files:**
- Create: `supabase/functions/reveal-decision-maker/index.ts`

**Interfaces:**
- Consumes: `revealApolloPerson` (Task 3), `resolveOrgApiKey` (existing).
- Produces: the HTTP contract `POST { candidate_id: string; reveal_email?:
  boolean; reveal_phone?: boolean } → { candidate: DecisionMakerCandidate }`
  — consumed by Task 8's `DecisionMakerReview`. Also produces the
  `APOLLO_WEBHOOK_SECRET` Supabase secret, consumed by this task (to build
  the webhook URL) and by Task 6 (`apollo-phone-webhook`, to verify it).

- [ ] **Step 1: Generate and set the webhook secret**

This is a secret *we* invent to authenticate calls to our own webhook — not
an external credential, so no need to involve Kevin. Generate a long random
value and set it directly:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Take the printed value and set it as a Supabase secret (replace
`<generated-value>` with the actual output — never reuse the example value
below):

```bash
npx supabase secrets set APOLLO_WEBHOOK_SECRET=<generated-value> --project-ref wgomksxelyfkzepbnkdd
```

Confirm it's set: `npx supabase secrets list --project-ref wgomksxelyfkzepbnkdd`
should now include `APOLLO_WEBHOOK_SECRET` (the value itself won't be shown,
only a hash — that's expected).

- [ ] **Step 2: Write the edge function**

`supabase/functions/reveal-decision-maker/index.ts`:

```typescript
// supabase/functions/reveal-decision-maker/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { revealApolloPerson } from '../_shared/apolloPeopleSearch.ts';

interface CandidateRow {
  id: string; lead_id: string; source: string; apollo_person_id: string | null;
  leads: { org_id: string };
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

  const body = (await req.json()) as { candidate_id?: string; reveal_email?: boolean; reveal_phone?: boolean };
  const candidateId = String(body.candidate_id ?? '');
  if (!candidateId) return json({ error: 'candidate_id is required' }, 400, headers);
  const revealEmail = body.reveal_email === true;
  const revealPhone = body.reveal_phone === true;
  if (!revealEmail && !revealPhone) return json({ error: 'reveal_email or reveal_phone is required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: candidate, error: readErr } = await service
    .from('decision_maker_candidates')
    .select('id, lead_id, source, apollo_person_id, leads!inner(org_id)')
    .eq('id', candidateId).single();
  if (readErr || !candidate) return json({ error: 'Candidate not found' }, 404, headers);
  const row = candidate as unknown as CandidateRow;
  if (row.source !== 'apollo' || !row.apollo_person_id) return json({ error: 'This candidate has nothing to reveal' }, 400, headers);

  const orgId = row.leads.org_id;
  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const apiKey = await resolveOrgApiKey(service, orgId, 'apollo');
  if (!apiKey) return json({ error: 'No Apollo API key configured for this organization' }, 400, headers);

  const webhookSecret = Deno.env.get('APOLLO_WEBHOOK_SECRET');
  if (revealPhone && !webhookSecret) return json({ error: 'Phone reveal is not configured on this deployment' }, 500, headers);
  const webhookUrl = revealPhone
    ? `${Deno.env.get('SUPABASE_URL')}/functions/v1/apollo-phone-webhook?candidate_id=${candidateId}&token=${webhookSecret}`
    : undefined;

  const result = await revealApolloPerson(row.apollo_person_id, apiKey, { revealEmail, revealPhone, webhookUrl });
  if (!result) return json({ error: 'Apollo could not reveal this contact' }, 502, headers);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (revealEmail) {
    patch.first_name = result.firstName;
    patch.last_name = result.lastName;
    patch.name_obfuscated = false;
    patch.email = result.email;
    patch.email_revealed = true;
  }
  if (revealPhone) patch.phone_status = 'pending';

  const { data: updated, error: updateErr } = await service
    .from('decision_maker_candidates').update(patch).eq('id', candidateId).select('*').single();
  if (updateErr) return json({ error: updateErr.message }, 500, headers);

  if (revealEmail && result.email) {
    const leadPatch: Record<string, unknown> = { email: result.email };
    if (result.firstName || result.lastName) leadPatch.owner_name = [result.firstName, result.lastName].filter(Boolean).join(' ');
    await service.from('leads').update(leadPatch).eq('id', row.lead_id);
  }

  return json({ candidate: updated }, 200, headers);
});
```

- [ ] **Step 3: Deploy and live-verify the email-reveal path**

Deploy fresh (layout `reveal-decision-maker/index.ts` + `_shared/*.ts`).
Using a real Apollo candidate found in Task 4's test
(`select id from decision_maker_candidates where source = 'apollo' and
lead_id = '<id1>'`), invoke:

```typescript
const { data } = await supabase.functions.invoke('reveal-decision-maker', {
  body: { candidate_id: '<candidate id>', reveal_email: true },
});
console.log(data);
```

Confirm: `candidate.email_revealed === true`, `candidate.name_obfuscated ===
false`, `candidate.email` is a real, non-null address. Query the lead
directly (`select email, owner_name from leads where id = '<id1>'`) and
confirm it was written there too — this is the "explicit action writes
directly" behavior, no separate apply step.

- [ ] **Step 4: Live-verify the phone-reveal request shape (not full delivery)**

Invoke with `reveal_phone: true` on a *different* candidate (don't reveal
phone on the same one twice — Apollo bills per successful reveal):

```typescript
const { data } = await supabase.functions.invoke('reveal-decision-maker', {
  body: { candidate_id: '<a different apollo candidate id>', reveal_phone: true },
});
console.log(data);
```

Confirm: `candidate.phone_status === 'pending'`. This confirms the request
was accepted and the row moved to the waiting state — the actual webhook
delivery is verified independently in Task 6 (this task can't force Apollo
to call the webhook on demand).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/reveal-decision-maker/index.ts
git commit -m "feat: add reveal-decision-maker edge function and webhook secret"
```

---

### Task 6: `apollo-phone-webhook` public edge function

**Files:**
- Create: `supabase/functions/apollo-phone-webhook/index.ts`

**Interfaces:**
- Consumes: `APOLLO_WEBHOOK_SECRET` (Task 5).
- Produces: a public `POST /functions/v1/apollo-phone-webhook?candidate_id=
  <id>&token=<secret>` endpoint that Apollo calls once a phone reveal
  finishes — the terminal step of the phone-reveal flow, no later task
  depends on its internals.

- [ ] **Step 1: Write the function**

`supabase/functions/apollo-phone-webhook/index.ts`:

```typescript
// supabase/functions/apollo-phone-webhook/index.ts
//
// PUBLIC endpoint — Apollo calls this directly, with no Supabase auth of any
// kind. verify_jwt MUST be false for this function (set at deploy time).
// Apollo documents no signature/verification scheme for this callback at
// all, so the `token` query param compared below IS the entire security
// boundary. Never log its value.
import { createClient } from 'npm:@supabase/supabase-js@2';

interface ApolloPhoneNumber { raw_number?: string; type_cd?: string }
interface ApolloWebhookPerson { id?: string; phone_numbers?: ApolloPhoneNumber[] }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  const url = new URL(req.url);
  const candidateId = url.searchParams.get('candidate_id');
  const token = url.searchParams.get('token');
  const expected = Deno.env.get('APOLLO_WEBHOOK_SECRET');
  if (!expected || !token || token !== expected || !candidateId) {
    return new Response(null, { status: 401 });
  }

  try {
    const body = await req.json() as { people?: ApolloWebhookPerson[] };
    const person = body.people?.[0];
    const phones = person?.phone_numbers ?? [];
    const mobile = phones.find((p) => p.type_cd === 'mobile');
    const chosen = mobile ?? phones[0];

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: candidate } = await service
      .from('decision_maker_candidates').select('id, lead_id').eq('id', candidateId).maybeSingle();
    if (!candidate) return new Response(null, { status: 200 }); // nothing to update, not Apollo's problem

    if (chosen?.raw_number) {
      await service.from('decision_maker_candidates')
        .update({ phone: chosen.raw_number, phone_status: 'revealed', updated_at: new Date().toISOString() })
        .eq('id', candidateId);
      await service.from('leads').update({ phone: chosen.raw_number }).eq('id', candidate.lead_id);
    } else {
      await service.from('decision_maker_candidates')
        .update({ phone_status: 'not_found', updated_at: new Date().toISOString() })
        .eq('id', candidateId);
    }
    return new Response(null, { status: 200 });
  } catch {
    // Never let a parsing error surface as a 5xx that might make Apollo
    // retry indefinitely — this is a best-effort callback, not a
    // caller-facing API.
    return new Response(null, { status: 200 });
  }
});
```

- [ ] **Step 2: Deploy with `verify_jwt: false`**

This is the one place in the whole plan where `verify_jwt` must be passed as
`false` to `deploy_edge_function` — every other function in this project
(and every other function in this plan) uses `true`. Double-check this
parameter before deploying.

- [ ] **Step 3: Live-verify both the reject and accept paths**

Reject path — wrong token must never touch the database:

```bash
curl -i -X POST "https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/apollo-phone-webhook?candidate_id=00000000-0000-0000-0000-000000000000&token=wrong-token" \
  -H "Content-Type: application/json" \
  -d '{"people":[{"id":"x","phone_numbers":[{"raw_number":"+1 555 000 0000","type_cd":"mobile"}]}]}'
```

Expect `HTTP/1.1 401`. Confirm no row anywhere was touched (there's no real
candidate with that id anyway, but the point is a 401 before any DB call).

Accept path — using the real `APOLLO_WEBHOOK_SECRET` value from Task 5 and
the real candidate id from Task 5 Step 4's phone-reveal test:

```bash
curl -i -X POST "https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/apollo-phone-webhook?candidate_id=<that candidate id>&token=<real secret>" \
  -H "Content-Type: application/json" \
  -d '{"people":[{"id":"apollo-person-id-doesnt-need-to-match-for-this-test","phone_numbers":[{"raw_number":"+1 202-555-0116","type_cd":"mobile"}]}]}'
```

Expect `HTTP/1.1 200`. Then confirm both writes landed:
```sql
select phone, phone_status from decision_maker_candidates where id = '<candidate id>';
-- expect: phone = '+1 202-555-0116', phone_status = 'revealed'

select phone from leads where id = (select lead_id from decision_maker_candidates where id = '<candidate id>');
-- expect: '+1 202-555-0116'
```

This confirms the full webhook path works correctly even though it was
triggered manually rather than by Apollo's real async delivery — the
function's logic is identical either way; the only thing this can't verify
is Apollo actually calling it (out of this project's control).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/apollo-phone-webhook/index.ts
git commit -m "feat: add public apollo-phone-webhook endpoint for async phone reveal"
```

---

### Task 7: `useDecisionMakers` hook

**Files:**
- Create: `src/hooks/useDecisionMakers.ts`

**Interfaces:**
- Consumes: `find-decision-makers` (Task 4), `DecisionMakerCandidate` (Task
  4).
- Produces: `useDecisionMakers()` returning `{ searching: boolean; error:
  string | null; runSearch: (leadIds: string[]) => Promise<Record<string,
  DecisionMakerCandidate[]>> }` — consumed by Task 9's wiring into
  `PipelineList.tsx`.

- [ ] **Step 1: Write the hook**

`src/hooks/useDecisionMakers.ts`:

```typescript
import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DecisionMakerCandidate } from '../types';

/**
 * Runs the free decision-maker search (Hunter + Apollo) for a batch of
 * leads. Never writes to a lead itself — Hunter's "Add to lead" and
 * Apollo's "Reveal" actions (handled inside DecisionMakerReview) are each
 * their own explicit, already-consented write.
 */
export function useDecisionMakers() {
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (leadIds: string[]): Promise<Record<string, DecisionMakerCandidate[]>> => {
    setSearching(true);
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke('find-decision-makers', {
      body: { lead_ids: leadIds },
    });
    setSearching(false);
    if (invokeErr) { setError(invokeErr.message); return {}; }
    const result = data as { results?: { lead_id: string; candidates: DecisionMakerCandidate[] }[]; error?: string };
    if (result.error) { setError(result.error); return {}; }
    const grouped: Record<string, DecisionMakerCandidate[]> = {};
    for (const r of result.results ?? []) grouped[r.lead_id] = r.candidates;
    return grouped;
  }, []);

  return { searching, error, runSearch };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useDecisionMakers.ts
git commit -m "feat: add useDecisionMakers hook"
```

---

### Task 8: `DecisionMakerReview` component

**Files:**
- Create: `src/components/pipeline/DecisionMakerReview.tsx`

**Interfaces:**
- Consumes: `DecisionMakerCandidate` (Task 4), `reveal-decision-maker` (Task
  5), `Lead`/`LeadPatch` (existing), the existing `Modal`/`Button` UI
  primitives.
- Produces: `<DecisionMakerReview open resultsByLead leadsById onClose
  onApplyHunter />` — consumed by Task 9's wiring into `PipelineList.tsx`.

- [ ] **Step 1: Write the component**

`src/components/pipeline/DecisionMakerReview.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { DecisionMakerCandidate, Lead } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface DecisionMakerReviewProps {
  open: boolean;
  resultsByLead: Record<string, DecisionMakerCandidate[]>;
  leadsById: Record<string, Lead>;
  onClose: () => void;
  onApplyHunter: (leadId: string, candidate: DecisionMakerCandidate) => Promise<string | null>;
}

function candidateName(c: DecisionMakerCandidate): string {
  const first = c.first_name ?? '';
  const last = c.last_name ?? '';
  const name = `${first} ${last}`.trim();
  return name || 'Unknown name';
}

/**
 * Review UI for the "Find decision maker" action. Unlike EnrichmentReview,
 * there's no diff-and-apply step — every action here (Hunter's "Add to
 * lead", Apollo's "Reveal email"/"Reveal phone") is its own explicit,
 * already-consented write. Subscribes to realtime updates on the visible
 * candidate rows so a phone number appears the moment Apollo's webhook
 * lands, with no polling.
 */
export function DecisionMakerReview({ open, resultsByLead, leadsById, onClose, onApplyHunter }: DecisionMakerReviewProps) {
  const [candidatesByLead, setCandidatesByLead] = useState<Record<string, DecisionMakerCandidate[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [errorByCandidate, setErrorByCandidate] = useState<Record<string, string>>({});

  useEffect(() => {
    setCandidatesByLead(resultsByLead);
    setAppliedIds(new Set());
    setErrorByCandidate({});
  }, [resultsByLead]);

  useEffect(() => {
    const allIds = Object.values(resultsByLead).flat().map((c) => c.id);
    if (allIds.length === 0) return;
    const channel = supabase
      .channel(`decision-maker-candidates-${allIds[0]}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'decision_maker_candidates', filter: `id=in.(${allIds.join(',')})` }, (payload) => {
        const updated = payload.new as DecisionMakerCandidate;
        setCandidatesByLead((prev) => {
          const list = prev[updated.lead_id];
          if (!list) return prev;
          return { ...prev, [updated.lead_id]: list.map((c) => (c.id === updated.id ? updated : c)) };
        });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // resultsByLead intentionally excluded beyond the id list captured above
    // — this subscription is set up once per search run (when the modal
    // opens with a new results set), not re-subscribed on every realtime
    // update it itself receives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsByLead]);

  async function handleApplyHunter(leadId: string, candidate: DecisionMakerCandidate) {
    setBusyId(candidate.id);
    const err = await onApplyHunter(leadId, candidate);
    setBusyId(null);
    if (err) setErrorByCandidate((prev) => ({ ...prev, [candidate.id]: err }));
    else setAppliedIds((prev) => new Set(prev).add(candidate.id));
  }

  async function handleReveal(candidate: DecisionMakerCandidate, field: 'reveal_email' | 'reveal_phone') {
    setBusyId(candidate.id);
    const { data, error } = await supabase.functions.invoke('reveal-decision-maker', {
      body: { candidate_id: candidate.id, [field]: true },
    });
    setBusyId(null);
    const apiError = error?.message ?? (data as { error?: string } | null)?.error;
    if (apiError) { setErrorByCandidate((prev) => ({ ...prev, [candidate.id]: apiError })); return; }
    const updated = (data as { candidate: DecisionMakerCandidate }).candidate;
    setCandidatesByLead((prev) => {
      const list = prev[updated.lead_id];
      if (!list) return prev;
      return { ...prev, [updated.lead_id]: list.map((c) => (c.id === updated.id ? updated : c)) };
    });
  }

  const leadIds = Object.keys(candidatesByLead);

  return (
    <Modal open={open} onClose={onClose} title="Find decision maker">
      <div className="flex flex-col gap-4">
        {leadIds.length === 0 && <p className="text-sm text-muted">No decision-maker candidates found for the selected leads.</p>}
        {leadIds.map((leadId) => {
          const lead = leadsById[leadId];
          const candidates = candidatesByLead[leadId] ?? [];
          return (
            <div key={leadId} className="rounded-lg border border-line p-3">
              <p className="mb-2 text-sm font-semibold">{lead?.business_name ?? leadId}</p>
              <ul className="flex flex-col gap-2">
                {candidates.map((candidate) => (
                  <li key={candidate.id} className="rounded bg-surface/60 p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase text-muted">{candidate.source}</span>
                      <span className="font-semibold">{candidateName(candidate)}</span>
                      {candidate.title && <span className="text-muted">— {candidate.title}</span>}
                    </div>
                    {candidate.source === 'hunter' && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-success">{candidate.email}</span>
                        <Button
                          variant="secondary"
                          onClick={() => void handleApplyHunter(leadId, candidate)}
                          disabled={busyId === candidate.id || appliedIds.has(candidate.id)}
                        >
                          {appliedIds.has(candidate.id) ? 'Added' : busyId === candidate.id ? 'Adding…' : 'Add to lead'}
                        </Button>
                      </div>
                    )}
                    {candidate.source === 'apollo' && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => void handleReveal(candidate, 'reveal_email')}
                          disabled={busyId === candidate.id || candidate.email_revealed}
                        >
                          {candidate.email_revealed ? candidate.email! : busyId === candidate.id ? 'Revealing…' : 'Reveal email'}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void handleReveal(candidate, 'reveal_phone')}
                          disabled={busyId === candidate.id || candidate.phone_status !== 'not_requested'}
                        >
                          {candidate.phone_status === 'revealed' ? candidate.phone!
                            : candidate.phone_status === 'pending' ? 'Waiting for phone number…'
                            : candidate.phone_status === 'not_found' ? 'No phone found'
                            : busyId === candidate.id ? 'Revealing…' : 'Reveal phone'}
                        </Button>
                      </div>
                    )}
                    {errorByCandidate[candidate.id] && <p role="alert" className="mt-1 text-xs text-danger">{errorByCandidate[candidate.id]}</p>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: clean (this component isn't wired into any page yet, so it can't
be live-verified in the browser until Task 9 — a clean typecheck is the bar
for this task).

- [ ] **Step 3: Commit**

```bash
git add src/components/pipeline/DecisionMakerReview.tsx
git commit -m "feat: add DecisionMakerReview component"
```

---

### Task 9: Wire "Find decision maker" into the Pipeline list

**Files:**
- Modify: `src/pages/PipelineList.tsx`

**Interfaces:**
- Consumes: `useDecisionMakers` (Task 7), `DecisionMakerReview` (Task 8), the
  existing `selected`/`leadsById`/`updateLead` already present in this file.

- [ ] **Step 1: Add the imports and state**

In `src/pages/PipelineList.tsx`, add to the icon import (`UserSearch` is
`lucide-react`'s closest fit for "find a person" and isn't used elsewhere in
this file):

```typescript
import { Inbox, PenLine, Plus, Radar, UserSearch } from 'lucide-react';
```

Add alongside the existing `useLeadEnrichment`/`useLeadEnrichment` import:

```typescript
import { useDecisionMakers } from '../hooks/useDecisionMakers';
import { DecisionMakerReview } from '../components/pipeline/DecisionMakerReview';
import type { DecisionMakerCandidate, EnrichableField, EnrichmentResult, Lead, Stage } from '../types';
```

Add new state, alongside the existing `enrichResults`/`reviewOpen`:

```typescript
const { searching: findingDecisionMakers, error: decisionMakerError, runSearch } = useDecisionMakers();
const [decisionMakerResults, setDecisionMakerResults] = useState<Record<string, DecisionMakerCandidate[]>>({});
const [decisionMakerReviewOpen, setDecisionMakerReviewOpen] = useState(false);
```

- [ ] **Step 2: Add the handlers**

Alongside the existing `handleFillMissingDetails`/`handleApplyEnrichment`:

```typescript
async function handleFindDecisionMaker() {
  const results = await runSearch([...selected]);
  setDecisionMakerResults(results);
  setDecisionMakerReviewOpen(true);
}

async function handleApplyHunterCandidate(leadId: string, candidate: DecisionMakerCandidate): Promise<string | null> {
  const patch: Record<string, string> = { email: candidate.email! };
  const name = `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim();
  if (name) patch.owner_name = name;
  return updateLead(leadId, patch);
}
```

- [ ] **Step 3: Add the toolbar button**

In the same `{selected.size > 0 && (...)}` block that already holds "Fill
missing details" and "Draft emails", add a third button:

```tsx
<Button variant="secondary" onClick={() => void handleFindDecisionMaker()} disabled={findingDecisionMakers}>
  <UserSearch className="h-4 w-4" aria-hidden />
  {findingDecisionMakers ? 'Searching…' : `Find decision maker (${selected.size})`}
</Button>
```

- [ ] **Step 4: Show the error and render the modal**

Alongside the existing `{enrichError && ...}` line:

```tsx
{decisionMakerError && <p role="alert" className="text-sm text-danger">{decisionMakerError}</p>}
```

Alongside the existing `<EnrichmentReview>` render:

```tsx
<DecisionMakerReview
  open={decisionMakerReviewOpen}
  resultsByLead={decisionMakerResults}
  leadsById={leadsById}
  onClose={() => setDecisionMakerReviewOpen(false)}
  onApplyHunter={handleApplyHunterCandidate}
/>
```

- [ ] **Step 5: Live-verify end-to-end in the browser**

Start the dev server if not running (`npm run dev`), navigate to
`/pipeline` (List view), select the same 2-3 Mr Brush & Co leads used in
Task 4's live verification (they already have candidate rows from that
test), click "Find decision maker (N)".

Confirm: loading state shows "Searching…", then the modal opens showing a
Hunter candidate (name, title, real email, "Add to lead" button) and/or an
Apollo candidate (obfuscated name, title, "Reveal email"/"Reveal phone"
buttons) per lead.

Click "Add to lead" on a Hunter candidate — confirm the button changes to
"Added" and stays disabled; query `select email, owner_name from leads where
id = '<that lead id>'` directly to confirm the write landed.

Click "Reveal email" on an Apollo candidate — confirm the button updates to
show the real revealed email address once the call completes; confirm via
direct query that both `decision_maker_candidates.email` and the lead's own
`email` column updated.

Click "Reveal phone" on a *different* Apollo candidate (a fresh one not
already phone-revealed in Task 5's tests — check
`select id from decision_maker_candidates where source = 'apollo' and
phone_status = 'not_requested'` to find one, or re-run Task 4's search on a
new lead to generate one) — confirm the button immediately shows "Waiting
for phone number…". Manually trigger the webhook the same way Task 6 Step 3
did (real candidate id, real secret, a crafted phone payload) and confirm
the modal's button updates to show the real phone number **without
reloading the page** — this proves the realtime subscription from Task 8 is
actually wired correctly, which is the one thing that can't be verified by
API calls alone.

- [ ] **Step 6: Run the full check and commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean (0 type errors, all existing tests still passing — this
plan added no new Vitest tests, per the Global Constraints note on why).

```bash
git add src/pages/PipelineList.tsx
git commit -m "feat: wire Find decision maker into the Pipeline list"
```
