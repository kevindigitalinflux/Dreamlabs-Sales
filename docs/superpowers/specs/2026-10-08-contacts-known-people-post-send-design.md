# Contacts per lead, known decision makers, and post-send updates: Design

Date: 2026-10-08. Status: draft for review. Built in three pieces in this order: A (contacts), B (known decision makers), C (post-send updates and sequence-aware templates). Each piece ships on its own.

## Intent (from Kevin, 2026-10-08)

- A lead like HOK has several people and inboxes: Andrea Manning (Office Manager, andrea.manning@hok.com, found via Hunter.io, not on Apollo.io) and a general inbox (london@hok.com). Today there is nowhere to add, edit or assign these, and Dream Agent answers that it cannot edit anything.
- Kevin sometimes already knows who to look for. He wants to type a full name and position, and have the app save that person and try to find more about them.
- Emails released from the review queue left the platform unchanged. The lead's sequence, next step and follow-up date should update, and composing for a lead in a sequence should offer that sequence's templates.

## Confirmed decisions

1. Known person: input in **both** places, an optional "I already know who" box inside Find decision maker (name, position, optional email) and an "Add person" button on the lead's contacts card. The app **always saves the person and always tries the lookups** (Hunter then Apollo for that exact name at the company's domain) for extra email, phone and LinkedIn.
2. Contacts: a **labelled contact list on the lead** that the user can add to, edit, remove, assign to a person manually, and mark which one is "use this one" (the main contact).
3. Dream Agent: **propose then confirm** (like every other Dream Agent action): add or update people and labelled emails, never silently.
4. Composer: **two separate emails, each addressed to its own contact** (the composer already drafts one email per ticked recipient).
5. Sequences: follow-up steps go to **everyone with an email, every step** (one drafted email per contact per step).
6. "Main" contact for bulk actions (Draft emails on selected leads, autopilot's first email, one-click composer): **the one marked "use this one"**, defaulting to the best decision maker with an email, else the general email.
7. After sending: **enrol or advance automatically**. If the sent template belongs to a sequence, enrol the lead at the following step (or advance one step when already enrolled at that step), set the follow-up date from the sequence delay, add a note. If not in any sequence, add a note and set a follow-up date: the sequence's next-step delay when exactly one sequence applies, else **3 days**.
8. Template picker for a lead in a sequence: **pre-select the current step's template, list only that sequence's templates, with a "Show all templates" toggle**. For a lead not in a sequence: **suggest the best-fitting sequence** with a one-click "Enrol in <sequence>".
9. Order: A, then B, then C.

## Open design choices (my recommendation applied; Kevin may overrule)

- **Include in sequences toggle per contact (default on).** Decision 5 means a general inbox such as reception receives every follow-up. A per-contact switch lets Kevin turn that off for one address without removing it. Recommended.
- **Opt-out is per lead.** If the lead opts out (unsubscribe link or manual flag), no contact on that lead is emailed. Per-address opt-out is not built now.
- **Existing lists.** `leads.additional_emails / additional_phones / additional_owners` (migration 038) are migrated into labelled contacts ("Additional email") and then read-only legacy.

## Piece A: contacts per lead

**Data.** Reuse `decision_maker_candidates` as the contact table instead of creating a second one. It already holds people (name, title, email, phone, LinkedIn, source) and is the recipient used by the composer (`decision_maker_candidate_id` on `email_logs`), autopilot's `pickRecipient`, LinkedIn capture and dismissal. Additive migration:
- `kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person','general'))`;
- `label TEXT` (display label, e.g. "General reception"; people use their name);
- `is_primary BOOLEAN NOT NULL DEFAULT false` with a partial unique index (one primary per lead);
- `include_in_sequences BOOLEAN NOT NULL DEFAULT true`;
- widen `source` to include `'manual'` and `'dream_agent'`;
- the generated `dedupe_key` stays (manual people dedupe by lowercased email or fall back to their id).
**Access.** Today candidates are written only by service-role functions. Add client policies so a member who can edit the lead (`can_edit_lead`) can INSERT, UPDATE (name, title, email, phone, label, linkedin_url, kind, is_primary, include_in_sequences, dismissed_at) and DELETE their own manual rows (rows from Hunter/Apollo can be edited but not deleted, only dismissed, as today). Column-scoped grants; no client write to `source`, `apollo_person_id`, `email_revealed`, `phone_status`. Needs a security review (changes RLS on an existing table).
**UI.** The Decision makers card becomes "Contacts": people and general inboxes together, each editable inline (name, position, email, phone, LinkedIn), with "Use this one", "Include in sequences", remove/dismiss, and "Add person" / "Add general email". Reuses existing components; the legacy additional-email chips migrate in.
**Composer.** Recipient list includes general contacts; two ticked recipients produce two drafts (existing behavior). Subject/body greeting uses the contact's name or a neutral greeting for general inboxes (a general contact has no first name: `{{first_name}}` templates should fall back to "Hi there" rather than park, unless the template insists on a name).
**Dream Agent.** New action types `add_contact` and `update_contact` (whitelist-sanitized like the existing actions; the contact id must belong to the lead index the client sent), shown as editable rows with confirm. The parse prompt receives each lead's current contacts so it can update instead of duplicating. Applied client-side through the new RLS.
**Sequences (decision 5).** `check-sequences` drafts one email per eligible contact per due step: contacts with an email, `include_in_sequences`, not dismissed, de-duplicated by email; the enrolment advances once per step (not once per contact). Failures for one contact do not stop the others. The existing per-day send cap counts each draft. `check-replies` already matches replies to the address actually emailed.
**Autopilot.** First email still goes to the marked main contact (`pickRecipient` honors `is_primary` first); follow-ups then follow decision 5.
**Migration of old data.** One-off SQL copies each non-empty `additional_emails` entry into a `general` contact labelled "Additional email" (unless already present).

## Piece B: known decision makers

- **Find decision maker dialog:** optional fields Name, Position, Email, LinkedIn URL. `find-decision-makers` accepts `known_person`. It upserts the person as a contact (`source = 'manual'` when typed by the user), then runs Hunter email-finder (first + last name + domain) and Apollo people match (name + organization/domain, title as a hint) using the org's keys, filling only BLANK fields (a differing email found is added as an extra person-linked email in the review step, never overwriting what Kevin typed). Existing paid-reveal rules apply (Apollo credits are only used when the org has a key and the user has not opted out); the review modal shows what was found and what each lookup cost.
- **"Add person" on the card** calls the same path (with a "also search" checkbox on by default).
- The default Find decision maker search (no known person) is unchanged and its results are saved as contacts as today.
- Error handling: a lookup failure never blocks saving the typed person; the result says which provider failed and why in plain English.

## Piece C: post-send updates and sequence-aware templates

**Post-send updates** (new `_shared/postSendUpdates.ts`, called from the `send-email` HTTP handler after a successful send of an email with a `lead_id`; **not** from `sendLeadEmail`, because autopilot already performs its own updates there):
1. Add a lead note "Email sent: <subject> (to <recipient name or address>)".
2. Work out the email's template (`email_logs.template_id` or template type; add the column if absent, set by the composer, bulk drafting and the queue).
3. If the log is already linked to an enrolment (`sequence_enrollment_id`: sequence-engine drafts advance at draft time), do not advance again; just keep the note and next-action date consistent.
4. Else if the lead has an active enrolment whose current step uses this template: advance one step with the shared advance logic (conditional update on id + current_step + status).
5. Else if the lead has no active enrolment and exactly one active sequence contains this template as a step: enrol at the following step, linked to the sent log.
6. Set `next_action_date` and `next_action_note` from the new enrolment's next step (`next_send_at`), else +3 days with the note "Follow up after email: <subject>". Only fill an existing next action if it is empty or already past, so a date Kevin chose is never overwritten.
7. Failures here never fail the send; they are reported in the response as a warning shown in the UI.
**Composer and queue:** show a short "What happens after sending" line (enrolment and follow-up date) so nothing changes silently.
**Template picker:** for a lead with an active enrolment, pre-select the current step's template and list only that sequence's templates, with a "Show all templates" toggle. For a lead without one, a "Suggested sequence" row (new small edge function `suggest-sequence` reusing `chooseSequenceClaude` and `pickSequence`) with a one-click "Enrol in <sequence>".
**Bulk Draft emails (Pipeline) and Waiting to release:** same post-send rules apply when released; the bulk draft modal limits template choice per lead the same way (leads in different sequences are grouped, or the picker shows the lead's own sequence template when "use each lead's sequence step" is ticked).

## Error handling and safety

- RLS changes are additive and security-reviewed; no client write to engine-owned columns.
- Every service-role function that accepts a lead or contact id re-checks the org (as everywhere else in this codebase).
- Never email a contact without a valid address, a dismissed contact, an opted-out lead, or a blocklisted address/domain.
- Dream Agent never applies contact changes without confirmation; unknown ids are discarded by the sanitizer.

## Testing

Pure logic (contact ranking for "main", sequence recipient selection, post-send decision table: enrol/advance/skip, follow-up date, template-to-sequence match, Dream Agent action sanitizing) in import-free modules tested from `src/lib/*.test.ts`. Live check on a throwaway org, then Kevin's own addresses.

## Out of scope

Per-address opt-out, merging duplicate leads, calendar integration, changing how the autopilot picks leads, any change to the Hunter/Apollo providers themselves.
