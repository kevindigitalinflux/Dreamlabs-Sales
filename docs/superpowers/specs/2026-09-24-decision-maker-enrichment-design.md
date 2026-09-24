# Decision-Maker Enrichment — Design Spec

## Overview

Bulk enrichment (`enrich-leads-bulk`) fills in generic contact fields (email,
phone, owner name) from free sources. It never tries to identify a specific
**named decision-maker** (owner, founder, C-suite, director) at a company —
that requires a different kind of lookup with a different cost model, and
mixing it into the existing silent-waterfall flow would risk burning paid
credits without the user ever seeing what they're spending on.

This spec adds a second, separate bulk action — **"Find decision maker"** —
using the same multi-select leads the existing "Fill missing details" button
already uses, but with its own review flow built around two providers that
behave very differently:

- **Hunter** — one domain-search call already returns real people with name,
  title, seniority, and a real (already-revealed) email address. No separate
  reveal step exists; the data is either in that response or it isn't.
- **Apollo** — a free search (`mixed_people/api_search`, 0 credits) finds a
  candidate but only returns their first name, an **obfuscated** last name
  (e.g. "Hu\*\*\*n"), and title — never contact info. Getting the real name
  plus an email and/or phone number requires a second, explicit, paid call
  (`people/match`) that the user must deliberately trigger per field, so
  credits are only spent on candidates worth the cost.

Because Apollo's phone reveal is **asynchronous** (delivered to a webhook
minutes after the request, not in the response), this spec also adds a new
public webhook endpoint and a tracking table to bridge that gap.

## Provider API Contracts (confirmed against Apollo's live docs, 2026-09-24)

**Search — `POST https://api.apollo.io/api/v1/mixed_people/api_search`**
(0 credits): `q_organization_domains_list[]` (lead's website domain),
`person_seniorities[]` (`owner`, `founder`, `c_suite`, `partner`, `director`),
`per_page: 1`. Response: `{ people: [{ id, first_name, last_name_obfuscated,
title, has_email, has_direct_phone, organization: { name, ... } }] }`. No
seniority field is returned — only usable as a request filter.

**Reveal — `POST https://api.apollo.io/api/v1/people/match`**: `id` (from
search), `reveal_personal_emails: true` and/or `reveal_phone_number: true`
(+`webhook_url`, required only for phone). Credits: 1 for demographics/email
if found, +8 more if a mobile phone is actually returned; 0 if nothing found.
Synchronous response includes full `first_name`/`last_name`/`name`/`email`
(when email revealed) — **never** the phone number, even when
`reveal_phone_number` is set.

**Phone webhook payload** (POSTed to whatever `webhook_url` was given):
```json
{
  "people": [
    { "id": "<apollo person id>", "status": "success",
      "phone_numbers": [{ "raw_number": "+1 202-555-0116", "sanitized_number": "+12025550116", "type_cd": "mobile", "status_cd": "valid_number" }] }
  ]
}
```
Apollo documents **no delivery-time SLA** and **no signature/verification
scheme** for this webhook — our endpoint must supply its own auth (see
Security below) and the UI must not promise a specific wait time.

## Data Model

New table, one row per `(lead_id, source)` — re-running search upserts rather
than duplicates:

```sql
CREATE TABLE decision_maker_candidates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source            TEXT NOT NULL CHECK (source IN ('hunter', 'apollo')),
  apollo_person_id  TEXT,                    -- apollo only; correlates the reveal call
  first_name        TEXT,
  last_name         TEXT,                    -- obfuscated for apollo pre-reveal, full otherwise
  name_obfuscated   BOOLEAN NOT NULL DEFAULT false,
  title             TEXT,
  email             TEXT,                    -- populated immediately for hunter; null for apollo until revealed
  email_revealed    BOOLEAN NOT NULL DEFAULT false,
  phone             TEXT,
  phone_status      TEXT NOT NULL DEFAULT 'not_requested'
                      CHECK (phone_status IN ('not_requested', 'pending', 'revealed', 'not_found', 'failed')),
  applied_at        TIMESTAMPTZ,             -- set once the user writes this candidate onto the lead
  created_by        UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, source)
);

CREATE POLICY "decision_maker_candidates_view" ON decision_maker_candidates
  FOR SELECT USING (can_view_lead(lead_id));
-- No client INSERT/UPDATE policy — every write goes through a service-role
-- edge function (search, reveal, or the webhook), same posture as
-- scrape_jobs/raw_leads.

ALTER PUBLICATION supabase_realtime ADD TABLE decision_maker_candidates;
```

## New Edge Function: `find-decision-makers`

`POST { lead_ids: string[] }` — same shape and guardrails as
`enrich-leads-bulk`: cap 40, resolve leads via service role, derive `org_id`
from the leads themselves (never trust a client-supplied org_id), require
membership. Bounded concurrency 5.

Per lead (skip entirely if no website):
1. **Hunter**, if the org has a key: `GET /v2/domain-search`. Unlike the
   existing `lookupHunterEmail` (which keeps only `value`/`confidence`), parse
   the full email object — `first_name`, `last_name`, `position`,
   `seniority`, `department`. Score candidates: prefer `seniority ===
   'executive'`, then a title match against
   `/owner|founder|chief|ceo|coo|cfo|cto|president|managing director|director/i`,
   then highest `confidence`. Upsert a `source: 'hunter'` row with
   `email_revealed: true` (Hunter never gates this behind a second call).
2. **Apollo**, if the org has a key: `POST /mixed_people/api_search` with the
   lead's domain and the seniority filter above, `per_page: 1`. If a person
   is found, upsert a `source: 'apollo'` row: `apollo_person_id`,
   `first_name`, `last_name` = the obfuscated value, `name_obfuscated: true`,
   `title`, everything else left at its default (no email/phone yet).

Response: `{ results: Array<{ lead_id, candidates: DecisionMakerCandidate[] }> }`
(only leads with at least one candidate). Each provider call keeps the
existing catch-and-return-null discipline — one bad lookup never fails the
batch.

## New Edge Function: `reveal-decision-maker`

`POST { candidate_id: string, reveal_email?: boolean, reveal_phone?: boolean }`.

1. Load the candidate (service role), join to its lead to derive `org_id`,
   verify membership. Reject if `source !== 'apollo'` (Hunter candidates have
   nothing to reveal) or if `apollo_person_id` is missing.
2. Resolve the org's Apollo key via `resolveOrgApiKey`.
3. Build the webhook URL only if `reveal_phone` is requested:
   `${SUPABASE_URL}/functions/v1/apollo-phone-webhook?candidate_id=${candidate_id}&token=${APOLLO_WEBHOOK_SECRET}`
   — the candidate id travels in the URL we control, so correlation on the
   way back never depends on trusting anything Apollo echoes.
4. `POST /people/match` with `id: apollo_person_id`, the requested reveal
   flags, and that `webhook_url` if phone was requested.
5. On a successful response: if email was requested, take the real
   `first_name`/`last_name`/`email`, update the candidate
   (`name_obfuscated: false`, `email_revealed: true`), and **write directly
   onto the lead** (`owner_name`, `email`) — this is an explicit,
   already-consented user action, so it skips the diff-review step the
   passive bulk waterfall uses. If phone was requested, set
   `phone_status: 'pending'` (no phone value yet — it's coming via webhook).
6. Return the updated candidate row.

## New Public Edge Function: `apollo-phone-webhook`

`verify_jwt: false` (Apollo cannot send our Supabase auth) — **must not**
follow the auth pattern every other function here uses.

1. Parse `candidate_id` and `token` from the request URL's own query string
   (not the body — Apollo doesn't echo request parameters back).
2. **Security**: compare `token` against `Deno.env.get('APOLLO_WEBHOOK_SECRET')`
   (plain string equality — this is a long random secret checked once per
   webhook call, not a per-request login, so timing-attack resistance isn't
   a real concern here); reject with a bare 401 on mismatch. This is the
   *only* verification available — Apollo documents no signature scheme — so
   this shared secret is the entire trust boundary for this endpoint. Never
   log the token value.
3. Load the candidate by `candidate_id` (service role). If the payload's
   `people[0].id` doesn't match the candidate's stored `apollo_person_id`,
   proceed anyway but note it — the URL-embedded `candidate_id` is the
   authoritative correlator we generated ourselves, the person-id check is a
   sanity cross-check only, not a gate.
4. Extract the best phone: prefer `type_cd === 'mobile'`, else the first
   entry in `phone_numbers`; use `raw_number` (matches the human-readable
   format `leads.phone` already stores from other sources). Empty array →
   `phone_status: 'not_found'`.
5. Update the candidate row, and **write the phone directly onto the lead**
   (same already-consented reasoning as email reveal).
6. Always respond `200` quickly, even on internal errors after step 2's auth
   check passes — this is a fire-and-forget callback from Apollo's side, not
   an endpoint whose response the webhook caller acts on.

## UI

**Trigger**: a second toolbar button next to "Fill missing details" on
`PipelineList.tsx`, "Find decision maker" (same selection mechanism, same
disabled-until-`selected.size > 0` behavior), calling `find-decision-makers`
and opening a new review modal.

**New component `DecisionMakerReview.tsx`** — one section per lead with at
least one candidate:

```
<lead business name>
  Hunter    Jane Doe — CEO — jane@company.com                    [Add to lead]
  Apollo    Andrew Hu***n — Professor... — Scicomm Media          [Reveal email]  [Reveal phone]
```

- **Hunter row**: "Add to lead" writes `owner_name`/`email` onto the lead
  immediately (plain RLS-protected `leads.update()`, no new edge function)
  and marks `applied_at`. Button reads "Added" and disables once clicked.
- **Apollo row**: "Reveal email" and "Reveal phone" are independent buttons,
  each callable alone or together. Clicking either calls
  `reveal-decision-maker` with the corresponding flag(s). While a phone
  reveal is `pending`, the button becomes a disabled "Waiting for phone
  number…" state; the modal subscribes to `postgres_changes` on
  `decision_maker_candidates` filtered to the visible candidate ids, so the
  row updates to the real number the moment the webhook lands — no polling,
  same pattern `useScrapeJob` already uses for live progress.
- A lead with no candidates from either source simply doesn't get a section
  — not an error, just nothing to show (matching `EnrichmentReview`'s
  existing convention).

## Error Handling

- No website on a lead → skipped in `find-decision-makers`, same as the
  existing bulk waterfall.
- Hunter/Apollo quota exhausted or key invalid mid-batch → that provider's
  lookups stop contributing for the rest of the batch; whatever the other
  provider found still shows.
- `reveal-decision-maker` failure (Apollo rejects the match, network error) →
  return the error inline on that candidate's row; no partial writes to the
  lead happen unless Apollo's response actually included the revealed value.
- Webhook arrives for a candidate that was deleted or already re-searched
  (upsert replaced the row, new `id`) → the `candidate_id` lookup finds
  nothing; log and return 200 anyway (nothing to update, not a retryable
  failure from Apollo's perspective).
- Webhook secret missing entirely (not yet configured) → the endpoint should
  fail closed (401 on every request) rather than skip the check.

## Security

- `APOLLO_WEBHOOK_SECRET`: a new global Supabase secret (one value, not
  per-org — this endpoint's only job is verifying the call came from a
  request *we* initiated, not scoping to a specific org; the org boundary is
  already enforced when `reveal-decision-maker` builds the URL from a
  candidate the caller was authorized to act on).
- The webhook endpoint is the only function in this project with
  `verify_jwt: false` outside of already-existing cron-secret-gated
  functions — call this out explicitly in review so it's never mistaken for
  an oversight.

## Testing

- Hunter candidate-scoring function: unit tests for seniority-first,
  title-match-second, confidence-fallback-third ordering, and the "no emails
  returned" empty case.
- `find-decision-makers`: live verification (this project's established
  pattern for edge functions) — cap enforcement, 403 for non-member, a lead
  with both providers configured produces both candidate rows, a lead with
  neither key configured produces no candidates without erroring.
- `reveal-decision-maker`: live verification of the email path (synchronous,
  can be fully asserted) and of the phone path's *request* shape (asserting
  the correct `webhook_url` is sent) — the actual webhook delivery can't be
  triggered on demand from a test, so verify the webhook handler
  independently.
- `apollo-phone-webhook`: live verification by POSTing a crafted payload with
  a valid and then an invalid token, confirming the 401 path never touches
  the database and the 200 path correctly updates both the candidate row and
  the lead's `phone` column.
- `DecisionMakerReview`: component test confirming the realtime subscription
  filter is scoped to exactly the candidate ids on screen, and that a
  `phone_status` change from `pending` to `revealed` re-renders the row
  without a manual refresh.
