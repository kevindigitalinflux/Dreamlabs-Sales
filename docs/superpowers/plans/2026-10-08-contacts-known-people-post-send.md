# Contacts, Known Decision Makers and Post-Send Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers read the cited existing files themselves; this plan fixes interfaces, decisions and acceptance tests, and per-task briefs expand the detail.

**Goal:** (A) a labelled, editable contact list per lead with Dream Agent edits and per-contact sequence follow-ups; (B) typing a known decision maker and having Hunter/Apollo look them up; (C) post-send platform updates (note, enrol/advance, follow-up date) and a sequence-aware template picker.

**Architecture:** Reuse `decision_maker_candidates` as the contact table (additive columns + client RLS). Pure logic in import-free `_shared` modules tested from `src/lib/*.test.ts`. Post-send updates run in the `send-email` handler (never inside `sendLeadEmail`, which the autopilot engine uses). Every RLS change gets a dedicated security review before it is applied.

**Tech Stack:** React 18 + TS strict + Tailwind, Supabase (RLS, Edge Functions on Deno), Vitest, Gemini/Claude helpers in `_shared/ai.ts`.

**Spec:** `docs/superpowers/specs/2026-10-08-contacts-known-people-post-send-design.md` (binding; its "Confirmed decisions" 1-9 are requirements).

## Global Constraints

- TypeScript strict, no `any`, named exports, JSDoc on exports, Tailwind only, components under ~150 lines, loading/error/empty states, no em or en dashes in copy.
- Migrations are additive and applied by the CONTROLLER via the Supabase MCP after review: next numbers `050`, `051`. Subagents never apply migrations, deploy, push, or run DB commands.
- Service-role functions that accept lead/contact ids must re-check org membership (CLAUDE.md pattern). RLS policy changes require the dedicated security review (opus) before applying.
- Pure modules in `supabase/functions/_shared/` have no imports and are tested via relative import from `src/lib/*.test.ts` (see `src/lib/autopilotEligibility.test.ts`).
- AI JSON through the guardrailed helpers in `_shared/ai.ts`; AI email text through `stripAiPunctuation`.
- Verify one at a time in the foreground: focused vitest, `npx tsc --noEmit`, `npx vitest run`, `npm run build` (UI), `--ignoreConfig` syntax check for Deno files (`npx tsc --noEmit --ignoreConfig --skipLibCheck --allowImportingTsExtensions --target esnext --module esnext --moduleResolution bundler --strict false <file>`, grep `error TS1`).
- Commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; subagents do not push.
- Existing flows must not regress: composer per-recipient drafts, autopilot `pickRecipient`, LinkedIn capture from candidates, Dream Agent confirm flow, `send-email` response shapes and error order.

## Review Focus

- A contact edited by a plain member must not be able to change engine-owned or provider-owned fields (`source`, `apollo_person_id`, `email_revealed`, `phone_status`) or reassign a contact to another lead or org.
- Two contacts with the same email (case-insensitive) on one lead: one email, not two; a dismissed contact is never emailed; a contact without a valid email is never a recipient; a lead that opted out sends to nobody.
- `is_primary`: at most one per lead (DB-enforced); deleting or dismissing the primary leaves a deterministic fallback.
- Post-send: a draft that the sequence engine already advanced (`sequence_enrollment_id` set) must not advance the enrolment a second time; a manually chosen next-action date is never overwritten; a failed post-send update never fails or hides the successful send.
- Sequence per-contact drafts: one enrolment advance per step regardless of contact count; one failing contact does not block the others; the daily send cap still bounds drafts.
- Known-person lookups: a lookup failure never blocks saving the typed person; provided email is never overwritten by a found one.

---

## PIECE A: contacts per lead

### Task A1: Migration 050 and types

**Files:** Create `supabase/migrations/050_lead_contacts.sql`; Modify `src/types/index.ts` (`DecisionMakerCandidate`).
**Produces:** columns `kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person','general'))`, `label TEXT`, `is_primary BOOLEAN NOT NULL DEFAULT false`, `include_in_sequences BOOLEAN NOT NULL DEFAULT true`, `source` widened with `'manual'` and `'dream_agent'`; partial unique index one primary per lead (`WHERE is_primary AND dismissed_at IS NULL`); client RLS: INSERT (`can_edit_lead(lead_id)`, `source IN ('manual','dream_agent')`, `created_by = auth.uid()`, `apollo_person_id IS NULL`, `email_revealed = false`, `phone_status = 'not_requested'`), UPDATE (column-scoped GRANT to `authenticated` on `first_name, last_name, title, email, phone, linkedin_url, kind, label, is_primary, include_in_sequences, dismissed_at, updated_at`; policy USING/WITH CHECK `can_edit_lead(lead_id)`), DELETE only rows with `source IN ('manual','dream_agent')` and `can_edit_lead(lead_id)`; a BEFORE UPDATE trigger forbidding changing `lead_id`, `source`, `apollo_person_id` from a client (`auth.uid() IS NOT NULL`); one-off copy of `leads.additional_emails` into `general` contacts labelled 'Additional email' (skip if the address already exists as a contact or is the lead's main email); the generated `dedupe_key` must still work for manual rows (read migration 039). Check `can_edit_lead`'s definition (018/022/023) and the live `pg_policies` for the table before writing.
- [ ] Implement, `npx tsc --noEmit`, commit `feat: migration 050 lead contacts`. Controller runs the security review, then applies.

### Task A2: Contact model (pure) and `pickRecipient` primary

**Files:** Create `supabase/functions/_shared/contacts.ts`, `src/lib/contacts.test.ts`; Modify `supabase/functions/_shared/autopilotChoices.ts` + its test.
**Produces:** `type Contact = { id; kind: 'person'|'general'; first_name; last_name; title; label; email; phone; is_primary; include_in_sequences; dismissed_at }`; `contactDisplayName(c)` (person: full name; general: label or 'General inbox'); `isUsable(c)` (not dismissed, plausible email); `mainContact(contacts, leadEmail)` (primary if usable, else best-ranked decision maker with email using the existing seniority tiers, else general contact, else lead email as `{ email, contactId: null }`); `sequenceRecipients(contacts, leadEmail, opted_out)` (usable, `include_in_sequences`, de-duplicated by lowercased email, stable order; empty when opted out; falls back to the lead email as a single recipient when there are no contacts); `validateContactEdit(input)` (trim, lowercase email, plausible email, name or label required, max lengths) returning `{ ok, value } | { ok: false, error }`. `pickRecipient` gives `is_primary` priority over seniority.
- [ ] TDD: failing tests first (primary beats seniority; dedupe case-insensitive; dismissed/invalid excluded; opted out empty; general contact naming; validation cases), implement, commit `feat: contact model and primary-aware recipient pick`.

### Task A3: Contacts card (UI)

**Files:** Modify `src/components/pipeline/DecisionMakersCard.tsx` (becomes the Contacts card; split sub-components `ContactRow.tsx`, `ContactForm.tsx`), `src/hooks/useDecisionMakers.ts` (add `addContact`, `updateContact`, `removeContact`, `setPrimary`, `setIncludeInSequences`), `src/components/pipeline/AdditionalDetails.tsx` (legacy email chips replaced by contacts; keep phones/websites/owners chips).
**Behavior:** list people and general inboxes together; inline edit of name, position, email, phone, LinkedIn, label; 'Use this one' radio; 'Include in sequences' toggle; Add person / Add general email forms (validate with `validateContactEdit`); remove deletes manual contacts and dismisses provider ones (existing dismissal helper); writes use `.select().single()` to surface RLS no-ops; org-switch and stale-response guards; plain-English errors. Registry/hunter/apollo rows keep their source label and reveal buttons.
- [ ] Implement with tests for any pure helper, `npm run build`, commit `feat: editable contacts card`.

### Task A4: Composer recipients and greetings

**Files:** Modify `src/components/emails/EmailComposer.tsx`, `RecipientDraftCard.tsx`, `src/lib/composerDrafts.ts` (+ tests).
**Behavior:** recipient list = usable contacts (people and general) plus the lead's own email, de-duplicated by email; ticking two creates two drafts (existing); a general contact greets with the template's neutral fallback ('Hi there') instead of a person's first name; `decision_maker_candidate_id` recorded on each draft's log; default tick = `mainContact`.
- [ ] TDD for the pure parts in `composerDrafts`, build, commit `feat: composer uses contacts`.

### Task A5: Dream Agent contact actions

**Files:** Modify `src/lib/dreamAgentActions.ts` (+ test), `supabase/functions/parse-session-notes/index.ts` and its prompt in `_shared/ai.ts`, `src/hooks/useDreamAgentSession.ts`, the Dream Agent action row components under `src/components/dreamagent/` (find them), `src/hooks/useDecisionMakers.ts` (apply path).
**Behavior:** new action types `add_contact` ({ lead_id, kind, first_name?, last_name?, title?, label?, email?, phone?, make_primary?, excerpt, rationale }) and `update_contact` ({ lead_id, contact_id, patch }); the parse prompt receives each lead's current contacts in the lead index (id, name/label, title, email, is_primary) and must update instead of duplicating; `sanitizeDreamAgentActions` whitelists fields, validates with `validateContactEdit`, and discards any `lead_id`/`contact_id` not in the index the client sent; rows are editable and need confirm (existing pattern); applying writes via the client contact API (RLS) with `source = 'dream_agent'`; failure per row does not undo others; never auto-applied. A note like Kevin's HOK example must produce an `add_contact` for Andrea Manning (Office Manager, andrea.manning@hok.com, make_primary) and `add_contact` kind general (london@hok.com, label 'General reception').
- [ ] TDD for the sanitizer (unknown ids dropped, bad emails rejected, injection-ish fields stripped, update cannot move a contact to another lead), prompt change, UI rows, build, commit `feat: dream agent contact actions`.

### Task A6: Sequence follow-ups per contact; autopilot primary

**Files:** Modify `supabase/functions/check-sequences/index.ts` (+ a pure helper in `_shared/contacts.ts`), `_shared/selectedLeadSteps/recipient.ts` only if needed for primary.
**Behavior:** for each due enrolment step, draft one email per `sequenceRecipients(contacts, lead.email, lead.opted_out)` (greeting per contact, `decision_maker_candidate_id` set), advance the enrolment exactly once; per-contact failures isolated; daily send cap counts every draft and stops cleanly; replies still match via `to_email`. Read how check-sequences loads templates, variables, ICP, notes and caps first; keep single-recipient behavior byte-identical for leads with no extra contacts.
- [ ] Implement, add tests for the pure recipient selection and advance-once logic, syntax checks, commit `feat: per-contact sequence drafts`.

## PIECE B: known decision makers

### Task B1: `known_person` lookup (backend)

**Files:** Modify `supabase/functions/find-decision-makers/index.ts`, `_shared/findDecisionMakers.ts`; Create `_shared/knownPerson.ts` (pure parts + providers); tests `src/lib/knownPerson.test.ts`.
**Behavior:** request body gains `known_person: { first_name, last_name, title?, email?, linkedin_url? }` for ONE lead. The person is upserted as a contact (`source 'manual'`, `kind 'person'`) before any lookup (a lookup failure never blocks this). Then: Hunter email-finder (first, last, domain from the lead website) if the org has a Hunter key and no email was given; Apollo people match (name, domain, title hint) if the org has an Apollo key, for blank email/phone/LinkedIn only (respect the existing paid reveal rules and `email_revealed`/`phone_status` handling; reuse the existing Apollo helpers); fill ONLY blank fields, never overwrite a typed value; a found different email is returned as `extra_email` suggestion (not saved) for the UI to offer. Response lists `{ saved, found: {email?, phone?, linkedin?}, source per field, errors: [plain English per provider], extra_email? }`. Org membership re-check as in the function today.
- [ ] TDD for the pure merge/fill-blank logic, syntax checks, commit `feat: known person lookup`.

### Task B2: UI for known person

**Files:** Modify the Find decision maker dialog/trigger (find in `src/components/pipeline/`), `DecisionMakerReview.tsx`, `ContactForm.tsx`.
**Behavior:** optional collapsible 'I already know who to look for' (name, position, email, LinkedIn); the Add person form gets an 'Also search for more details' checkbox (on by default) that calls the same endpoint; the review shows what was typed, what was found per provider and which provider failed; an `extra_email` suggestion has an 'Add as another contact' button.
- [ ] Build, commit `feat: known decision maker input`.

## PIECE C: post-send updates and sequence-aware templates

### Task C1: Migration 051 and template link on logs

**Files:** Create `supabase/migrations/051_email_log_template.sql`; Modify composer/bulk/draft insert paths to set it, `src/types/index.ts`.
**Produces:** `email_logs.template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL` (additive, nullable, no RLS change); `EmailComposer`, `BulkDraftModal`, `generate-email`/`check-sequences` draft inserts and autopilot `insertDraftLog` set it when a template is known.
- [ ] Implement, commit `feat: migration 051 email log template link`. Controller applies.

### Task C2: Post-send decision table (pure)

**Files:** Create `supabase/functions/_shared/postSendRules.ts`, `src/lib/postSendRules.test.ts`.
**Produces:** `decidePostSend({ templateId, templateType, enrollment, sequences, logLinkedToEnrollment, nextActionDate, now, timezone })` returning `{ action: 'none'|'advance'|'enrol', sequenceId, step, nextSendAt, completed, nextActionDate, nextActionNote, note }` per spec Piece C steps 3-6 (already-linked draft: no advance; active enrolment whose current step uses the template: advance; no enrolment and exactly one sequence containing the template: enrol at following step; else follow-up in 3 days; never overwrite a future manual next-action date; template matched by `template_id` or default template type of the step). Reuse `nextEnrollmentState` semantics from `selectedLeadPipelineRules.ts` (import-free copy or shared).
- [ ] TDD with the full decision table including edge cases (last step completes; step index out of range; two sequences contain the template; no template id; template in zero sequences; future date preserved; past date replaced), commit `feat: post-send decision rules`.

### Task C3: Wire post-send updates into send-email

**Files:** Create `_shared/postSendUpdates.ts`; Modify `supabase/functions/send-email/index.ts`, the UI callers (EmailComposer, ReleaseQueue, EmailReviewQueue) to show the returned warning and a 'What happens after sending' preview line.
**Behavior:** after a successful send with a `lead_id`, load the lead, enrolment, org sequences and the log's template, call `decidePostSend`, then apply: lead note ('Email sent: <subject> (to <name or address>)'), conditional enrolment insert/advance (same conditional update pattern as the autopilot), `email_logs.sequence_enrollment_id` link, `leads.next_action_date/next_action_note`; never touch anything when the send failed; failures are caught and returned as `warning` without changing `ok`; all reads scoped to the lead's org; does NOT run for autopilot (the engine calls `sendLeadEmail` directly). Response shape otherwise unchanged.
- [ ] Implement, syntax checks, commit `feat: post-send platform updates`. Controller redeploys `send-email`; Kevin sends one real email to verify.

### Task C4: Sequence-aware template picker and suggestion

**Files:** Modify `EmailComposer.tsx` template picker, `BulkDraftModal.tsx`; Create `src/hooks/useLeadSequenceContext.ts`, `supabase/functions/suggest-sequence/index.ts`, UI `SuggestedSequence.tsx`.
**Behavior:** for a lead with an active enrolment the picker pre-selects the current step's template, lists only that sequence's templates, with 'Show all templates'; for a lead without one, `suggest-sequence` (user JWT, org membership, one Haiku call via `chooseSequenceClaude` + `pickSequence`, constrained to the org's real sequences) returns the best sequence and a one-click 'Enrol in <sequence>' (enrols via `useEnrollments.enroll`); bulk modal: when leads span different sequences, offer 'Use each lead's own sequence step' (drafts per lead with its own current-step template) else the single chosen template.
- [ ] Implement with pure helper tests (picker option ordering), build, syntax checks, commit `feat: sequence-aware template picker`.

### Task C5: Docs, final review, deploy

- [ ] CLAUDE.md entry; whole-branch review (opus) with a security review of migration 050; apply migrations 050 and 051 (after pre-checks of live `pg_policies`), deploy changed functions (`find-decision-makers`, `parse-session-notes`, `check-sequences`, `send-email`, `suggest-sequence`, plus any importing changed `_shared` modules), push main, update `docs/TODO.md`.

## Self-review

- Spec coverage: decisions 1-9 map to A3/A5 (contacts, Dream Agent), A4 (composer), A6 (sequences, primary), B1/B2 (known person), C1-C4 (post-send, picker). The open choice 'include in sequences' is in A1/A2/A3/A6.
- Interfaces: `Contact`, `mainContact`, `sequenceRecipients`, `validateContactEdit` (A2) are consumed by A3, A4, A5, A6; `decidePostSend` (C2) by C3.
- Known unknowns to verify in task briefs: exact `can_edit_lead` semantics; whether Dream Agent apply path is client-side only; Apollo helper names in `_shared`; where Find decision maker dialog lives.
