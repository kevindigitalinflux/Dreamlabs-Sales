# Calling Integration — Design Spec

## Context

Today, "calling" in Dreamlabs Sales is entirely manual: a contractor sees a `tel:` link on a lead,
dials on their own phone, and logs a call note afterward (`lead_notes.note_type = 'call'`,
bumping `leads.call_count`). This spec adds real telephony integration in two phases: a **power
dialer** (a human contractor on every call, but the dialing itself is automated — skips
voicemails/no-answers, auto-advances through a list) built now, and a **fully autonomous AI voice
agent** (no human on the call at all) built last, once its voice quality has been proven out
directly in the chosen provider's own tooling.

## A note on legal risk (read this before anything else)

Outbound cold calling — and AI-voiced calling specifically — carries real regulatory exposure in
the US (TCPA) and UK (PECR). The FCC has ruled that AI-generated/prerecorded voice calls fall
under the same robocall rules as traditional ones, generally requiring prior express consent
before an AI agent cold-calls a US number; statutory penalties run $500–$1,500 *per call* with no
aggregate cap. This is not a compliance checkbox this spec can close — **it needs a real
telemarketing/TCPA attorney's sign-off before any AI voice agent (and arguably the power dialer
too, for blind cold-list dialing) ever calls a real, unconsented US or UK prospect.** This spec
builds the technical switches that decision needs (an explicit, org-level, off-by-default "calling
enabled" gate; consent/recording-disclosure tracking), but flipping them on for real cold outreach
is Kevin's call to make with counsel, not an engineering decision.

## Decisions Locked (from brainstorming)

| Decision | Choice |
|---|---|
| Scope, this build | **Phase 1 (build now): Power dialer.** Phase 2 (build last, after Kevin has hands-on tested voice quality directly in whichever AI platform he lands on — Vapi is the current front-runner, also evaluating Retell AI and Bland AI): fully autonomous AI voice agent. This spec covers Phase 1 in full detail; Phase 2 is captured architecturally (enough that Phase 1's schema doesn't need rework later) but deliberately not over-specified, since its concrete shape depends on Kevin's own provider evaluation. |
| Call audience | Both warm/opted-in leads and the existing cold/scraped pipeline are in scope eventually. Blind cold-list AI calling specifically sits behind the off-by-default "calling enabled" org gate described above — not something this build turns on by default for anyone. |
| Provider choice (power dialer) | Deliberately deferred — Kevin is evaluating JustCall, Kixie, and Aircall himself. All three have real REST APIs with webhook support, so the choice doesn't block this spec's architecture: built provider-agnostic (schema, notes pipeline, UI shell) with a swappable adapter boundary, mirroring this app's existing `resolveOrgApiKey`/`draftEmail`-vs-`draftEmailClaude` pattern for AI providers. |
| Provider choice (AI voice agent) | Also deferred (Vapi/Retell AI/Bland AI under evaluation) — same provider-agnostic principle applies. |
| Credential model — power dialer | **Per-contractor**, mirroring `user_email_settings` — each person connects their own dialer account/line, matching how calling is naturally a personal activity (not a shared org resource, unlike Gemini/Places/Anthropic). |
| Credential model — AI voice agent | **Per-org**, mirroring `org_api_settings`/`resolveOrgApiKey` — an AI voice agent is a shared "virtual salesperson" resource the org deploys, not tied to one contractor's own line. Needs the same guided, non-technical-friendly setup wizard pattern already used for Gemini/Places/SMTP (a locked requirement, not an afterthought — Kevin flagged this explicitly). |
| Telephony architecture | Dreamlabs Sales does **not** rebuild real-time call signaling itself (a much bigger, harder problem than this app needs to take on). It pushes a filtered lead list into the provider's own dialer queue/UI (most of these platforms already have a mature embedded power-dialer widget) and receives webhooks back with each call's outcome. |
| AI-generated call notes | **Reuse the existing `parse-notes` Gemini function**, not a new/separate summarization pipeline — a call transcript gets the same "suggested CRM field updates" treatment already built for manually-typed notes (stage change, deal value, next action, pain point). One consistent note-taking experience regardless of whether the note came from typing or a real call. |
| Human-in-the-loop for the AI voice agent (Phase 2) | Explicitly required by Kevin ("keep tabs"), exact mechanism not yet locked — likely candidates (live listen-in, mandatory post-call review before a note/CRM update is finalized, or both) to be resolved when Phase 2 is actually scoped, once Kevin has tested real AI-agent call quality. Not designed in detail here — flagged so Phase 1's schema doesn't foreclose it. |

---

## 1. Schema (Phase 1 — provider-agnostic)

```sql
-- New migration, e.g. 013_calling_integration.sql

-- Per-contractor dialer connection, mirrors user_email_settings exactly.
CREATE TABLE user_dialer_settings (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  provider      TEXT NOT NULL CHECK (provider IN ('justcall', 'kixie', 'aircall')),
  phone_number  TEXT,                    -- the contractor's connected/provisioned number, for display
  is_verified   BOOLEAN DEFAULT false,
  -- the actual API key/secret is Vault-stored via a new app_set_dialer_secret/
  -- app_get_dialer_secret RPC pair, matching the existing app_set_smtp_secret
  -- pattern exactly -- never a plain column.
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_dialer_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dialer_settings_own" ON user_dialer_settings
  USING (auth.uid() = user_id);

-- One row per completed call, regardless of provider.
CREATE TABLE calls (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id           UUID REFERENCES leads(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES profiles(id),          -- the contractor who made/took the call
  org_id            UUID REFERENCES organizations(id),
  provider          TEXT NOT NULL,
  external_call_id  TEXT NOT NULL,        -- the provider's own call ID -- dedupes retried webhooks
  direction         TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  outcome           TEXT CHECK (outcome IN ('answered', 'voicemail', 'no_answer', 'busy', 'failed')),
  duration_seconds  INTEGER,
  recording_url     TEXT,
  transcript        TEXT,
  lead_note_id      UUID REFERENCES lead_notes(id),         -- the note this call generated, once created
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, external_call_id)
);
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
-- Org-scoped, matching every other cycle-3+ table's established pattern.
CREATE POLICY "calls_org_admin" ON calls FOR ALL USING (is_org_admin(org_id));
CREATE POLICY "calls_own_in_org" ON calls FOR ALL
  USING (is_org_member(org_id) AND (auth.uid() = user_id OR user_id IS NULL));
```

`lead_notes.note_type` already includes `'call'` in its CHECK constraint (from the original cycle-1
schema) — no change needed there. This confirms manual call-logging was already designed in from
day one; this build automates and enriches an existing, already-correct data model rather than
inventing a new one.

The `user_id IS NULL` clause in `calls_own_in_org` follows this app's established
system-generated-row convention (same reasoning as cycle 5's `leads.created_by`/
`sequence_enrollments.enrolled_by`), in case a future automated flow (e.g. Phase 2's AI agent)
logs a call with no specific human owner.

## 2. Edge functions (Phase 1)

- **`dialer-settings`** — mirrors `email-settings` exactly: `get`/`save`/`test` actions for a
  contractor's own dialer connection. `test` validates the API key against whichever provider is
  connected (mirroring `org-api-settings`'s `validateKey` pattern, implemented per-provider once
  Kevin's choice is confirmed).
- **`dialer-push-queue`** — triggered from the Power Dialer UI: takes a filtered lead list and
  pushes it into the connected provider's own dialer queue via their API. Provider-specific
  implementation (exact API shape depends on which of JustCall/Kixie/Aircall Kevin picks) —
  **not written here**, since guessing at a specific provider's API contract without their real
  docs in hand would produce code that's wrong by construction. Build this task once the provider
  is chosen.
- **`dialer-webhook`** — receives call-outcome callbacks from the provider. **Authentication is
  necessarily provider-specific** (each platform signs webhooks differently — HMAC signature
  schemes vary by provider, header names vary) and is a real security requirement, not optional:
  unlike `unsubscribe` (low-risk, one specific known lead per request), a call-outcome webhook with
  no real signature verification would let anyone fabricate fake call records for any lead. Flagged
  here explicitly as an implementation detail to get right when the provider is chosen, not
  something to defer or skip. On a verified, genuine webhook: insert into `calls` (using
  `external_call_id` for idempotency against retries), and if a transcript is present, call the
  existing `parse-notes` function to generate the summary + suggested field updates, inserting the
  result as a `lead_notes` row (`note_type: 'call'`) and linking it back via `calls.lead_note_id`.

## 3. Frontend (Phase 1)

- **`/settings/dialer`** — per-contractor guided connection wizard, matching `/settings/email`'s
  existing pattern exactly (provider picker, plain-English guided steps, test-connection action).
- **Power Dialer page** (route TBD at implementation time, e.g. `/dialer`) — pick a lead filter
  (e.g. "New leads with a phone number, not called in the last 7 days"), see the count, click
  "Start dialing session." Exact UX for handing off to the provider's own dialer widget (embedded
  vs. external redirect) depends on which provider is chosen — most of JustCall/Kixie/Aircall offer
  a browser-based CTI widget, which is the most likely fit.
- **Lead detail page** gains a "Calls" section (mirroring the existing "Emails"/LinkedIn-style
  sections), listing call history from the new `calls` table — outcome, duration, a link to the
  recording if present, and the linked call note.

## 4. Phase 2 (AI Voice Agent) — architectural placeholder only

Not detailed here beyond the locked decisions in the table above (org-level credentials via a
guided setup wizard; human-in-the-loop oversight required, mechanism TBD; the explicit legal-gate
requirement). Revisit once Kevin has hands-on evaluated Vapi/Retell AI/Bland AI and has a specific
provider and a tested, non-robotic-sounding voice/script ready — at that point this spec gets a
real Phase 2 section written the same way Phase 1 got one here, not before.

## Testing

- Unit: idempotency of `dialer-webhook` on a duplicate `external_call_id` (should update, not
  double-insert); `dialer-settings`' provider-specific key validation.
- Live verification (controller-performed, matching this project's established pattern): a
  throwaway lead + a manually-fabricated (but properly-authenticated, once that mechanism is built)
  webhook payload, confirming a `calls` row and a linked `lead_notes` row are created correctly,
  and that `parse-notes`' suggested-updates flow works identically for a call-derived note as it
  does for a typed one.
- Full E2E with a real phone call through a real connected dialer account is out of reach without
  Kevin's own real provider account and a real test call — same accepted pattern as this project's
  other external-integration gaps (documented as a pending human step, not a blocker).

## Out of Scope (this spec)

- Any actual provider integration code (`dialer-push-queue`'s and `dialer-webhook`'s real API/auth
  logic) — blocked on Kevin's provider choice, by design, not an oversight.
- Phase 2's full design — deliberately deferred, see §4.
- The specific human-in-the-loop mechanism for Phase 2's AI voice agent — a real design decision
  for when that phase is scoped, not guessed at here.
- Legal compliance determination itself — this spec builds the switches; using them for real cold
  outreach requires Kevin's own legal counsel, not an engineering sign-off.
