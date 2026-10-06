# Registry contacts (Companies House + CRO) and Selected-Leads Autopilot — Design

Date: 2026-10-07. Status: draft for review. Built in five independently shippable pieces (see Build order).

## Intent

- **UX Tree** (and any org selling in Ireland) needs Irish company data: a new **CRO** API key option and scraper source that behaves like Companies House.
- Companies House and CRO return business data only (name, number, address, status, officers). Today officer details and company contact details get mixed together, and real decision-makers are missed. Registry results must become **a lead (the company, with company contact details only) plus decision-maker candidates (each person, with their title and their own contact details)**.
- Autopilot gets a new **Selected leads** mode: the user picks pipelines and specific leads; autopilot researches each lead deeply, drafts and **sends** a tailored email within a user-set daily time window, and updates the whole platform (notes, stage, last contacted, sequence enrolment/progress, follow-up date). Problem leads never halt the run.

## Confirmed decisions (from the user)

- Registries return no contact details themselves; contact details come from a free-first lookup (website via Google Places, scrape for company email/phone; Hunter/Apollo for each person only if the org has those keys).
- People found via a registry are saved as decision-makers with a title, never merged into the lead's company contact fields. A person with no contact found is flagged, not blank-merged.
- Selected-leads mode is a new mode inside the existing autopilot setup flow, limited to the active org.
- Each lead is processed individually: fully automatic unless something specific (e.g. an unfillable placeholder) needs a human, in which case that lead is parked in a "Needs your input" queue and the run continues.
- Research sources: the lead record and notes, decision-maker search (Hunter/Apollo), deep website read, and web search via **Gemini with Google Search grounding** (uses the org's existing Gemini key; no new provider).
- Sequence choice: continue the lead's current sequence if enrolled; otherwise enrol in the best-fitting existing outreach sequence chosen from notes and research (constrained to the org's real sequences), falling back to the lead's pinned profile's sequence.
- Skips (reported, not silent): no email after fill-missing-details and decision-maker search; contacted recently and not due; opted out; blocklisted.
- Timing: runs on the chosen day between a user-set start and finish time (with timezone). Leads not reached by the finish time stay queued and are reported as "not reached".
- Sends from the mailbox of the user who started the run. Existing daily send cap and spend cap apply.
- Picker: by pipeline, checklist plus "select all in pipeline", individually unselectable. Shows only leads never contacted/enrolled, or with a sequence step due today or overdue.

## Open item to verify before Piece 1

CRO's free open data does **not** include directors; director data needs an authenticated CRO account. Before building, confirm via CRO's developer documentation (and Valentina's account) what the keyed Open Services API returns. If it returns company-level data only, Irish decision-makers come from Hunter/Apollo and the website instead of from CRO officers. The shared registry step must treat "no officers from the registry" as normal.

## Piece 1 — CRO provider and registry-to-lead mapping

- New provider value `cro` in `org_api_settings` (migration widening the provider check, as migration 029 did for `google_places_pro`), Vault-stored like other keys, with a guided setup entry (`PROVIDERS` array in `OrganizationSettings.tsx`) and a live key check in `org-api-settings` `validateKey()` that costs nothing. Global fallback: none (UX Tree configures its own).
- New edge function `scrape-cro` mirroring `scrape-companies-house` (org membership check, same `scrape_jobs`/`raw_leads` flow); scraper source picker offers it only for Irish ICPs, like Companies House is UK-only.
- Shared `_shared/registryLeads.ts`: given registry companies (+ officers when available) it (a) writes company-level fields only to `raw_leads`, (b) records officers as candidates (name, role as title, `source = 'registry'`), (c) runs the lookup waterfall for the company and each person, (d) marks anyone without contact as "no contact found". Companies House and CRO both use it. `decision_maker_candidates.source` currently allows hunter/apollo; widen it (additive migration) to include `companies_house` and `cro`.
- Approving a registry raw lead (`useRawLeadActions.approve`) carries its candidates onto the new lead.

## Piece 2 — Selected-leads data model, eligibility, picker

- `autopilot_runs`: add `mode` (`discover` | `selected`, default `discover`), `window_start`/`window_end` (local time), `timezone`, `window_date`. Replace the one-active-run-per-org unique index with one active run per org **per mode**.
- New `autopilot_run_leads(run_id, lead_id, org_id, status, reason, email_log_id, sequence_id, claimed_at, updated_at)`; status `queued | working | sent | skipped | needs_input | failed | not_reached`; org-scoped RLS matching `autopilot_runs` (including the null-owner allowance); added to the realtime publication; `UNIQUE(run_id, lead_id)`.
- Pure, unit-tested `src/lib/autopilotEligibility.ts` (mirrored for Deno in `_shared`): a lead is eligible when not opted out/blocklisted and either never contacted and not enrolled, or has an active enrolment whose `next_send_at <= end of today`; "contacted recently and not due" is excluded and counted.
- Picker UI in `AutopilotSetup` for mode `selected`: pipeline list, per-pipeline checklist, select-all, hidden-count line, start/finish time and timezone, send cap, spend cap, cost estimate.

## Piece 3 — Per-lead research

New `_shared/leadResearch.ts`, run once per lead and saved as an `ai_summary` lead note listing cited sources:
- inputs: lead record, notes, pinned profile (ICP), decision-makers;
- deep website read: homepage plus about/services/team/news pages, same SSRF guard as `websiteContact.ts` (`parseSafeWebsiteUrl`), small page and size caps;
- Gemini with Google Search grounding for recent news, LinkedIn presence, reviews;
- bounded cost per lead, counted against the spend cap; failures degrade (research is best-effort, the draft still proceeds from available context).

## Piece 4 — Engine: draft, send, platform updates

New edge function `run-selected-autopilot`, invoked on Start and by a cron tick every few minutes. Auth: cron-secret path for ticks, user JWT with org-membership check for Start; every lead id re-validated against the run's org (service role bypasses RLS).
Per tick: inside the window only; claim a batch of `queued` rows (set `working` + `claimed_at` before doing anything, so a repeated tick can never double-send); for each lead: re-check eligibility, opt-out, blocklist; fill missing details and decision-maker search if there is no email; research; choose sequence/step; draft via the existing notes-then-draft path (Haiku writes from Sonnet notes); placeholder check; send through the shared send path as the run's creator; spacing between sends.
On send (shared helper, also used by existing send paths where sensible): `email_logs` row, `lead_notes` entry, `last_contacted_at`, `new_lead` to `contacted` only, enrol in or advance the chosen sequence (`current_step`, `next_send_at`), set `next_action_date`/note from the next step's due date, increment `outreach_sent_total`.
Outcomes per lead: `sent`, `skipped` (with reason), `needs_input` (draft saved to the review queue with the reason), `failed` (error kept), `not_reached` (window closed). Run completes when no `queued` rows remain or the window ends; daily send cap or spend cap stops it cleanly.

## Piece 5 — Status page and Needs-your-input queue

- Live per-lead list grouped Sent / Needs your input / Skipped (reason) / Not reached / Failed, via realtime.
- "Needs your input" rows open the saved draft to fix and send; counts surface on the Dashboard and Emails so they are visible after being away.

## Error handling and safety

- One lead's failure never stops the run. AI JSON uses the existing Claude guardrails (stop-reason check, retry once).
- Org-membership check on every service-role entry point; ids from the client are never trusted.
- No send without a non-empty email, a non-opted-out lead, and passing the blocklist at send time.
- No secrets in the client; the CRO key lives in Vault.

## Testing

Unit tests: eligibility rule, window/cap maths, sequence/step choice, placeholder check, registry mapping (company vs officers), CRO response parsing. Live verification with a throwaway org and test leads addressed to the user's own mailboxes, then cleanup; typecheck, vitest and build green before each push.

## Build order

1. Piece 1 (CRO + registry mapping) — ships alone, unblocks UX Tree.
2. Piece 2 (data model, eligibility, picker).
3. Piece 3 (research).
4. Piece 4 (engine).
5. Piece 5 (status page, queue).

## Out of scope

Replacing the existing discover-mode autopilot, a separate web-search provider, multi-org runs, LinkedIn sending, and any change to RLS on existing tables beyond what is listed.
