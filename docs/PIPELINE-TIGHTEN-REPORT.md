# Pipeline tighten — item 1 and mandatory SQL checkpoint (2026-11-11)

**Partial build: item 1's policy foundation is complete; items 2–12 are not built.** Kevin explicitly required migration SQL to be written in this report followed by a stop, without applying it. Source inspection identified required storage for trustworthy send-time tier measurement and mailbox-specific hard-bounce attribution. That instruction is the stop reason; this is not an allowance claim or a completed-pipeline claim.

Worktree: C:/Users/kevin/Projects/dreamlabs-sales-accuracy. Branch codex/pipeline-tighten was created from clean origin/main 72c205c200b543468ce4b249b2d3e9e3f8f602d8, exactly as Kevin requested. Codex remains builder/sole checkout writer; Claude remains architect/reviewer. No nested CLI agent was started. This item/checkpoint is one commit, with explicit paths, disabled hooks and the Codex trailer. No other task or checkout was edited.

## Item 1: built and tested

recipientTier.ts is pure and import-free. It returns tier, a stable basis and a plain reason. It binds evidence to the exact address; syntax, opt-out, blocklist, hard bounce, invalid checker and absent mail server defeat positive evidence. T1 includes checker-valid, replied, sent_ok, own-site, Places and explicitly non-guessed saved company addresses. Generated provenance cannot become strong merely because it was saved. T2 requires a generated candidate, known mail server, an exact-domain matching format and two distinct T1 people/addresses. It never bootstraps from the candidate itself. The optional supportedGuessAllowed input is only a seam for item 11's future confidence rule; that rule is not implemented or enabled.

Kevin answered the role-address question in this session: **a hosted/catch-all role address stays T3 despite publication/checker-valid evidence unless it has replied or earned sent_ok**. Hard negatives still defeat that history. This ruling is implemented and tested.

recipientTierEvidence.ts adapts the existing emailSyntaxValid, roleAddressNeedsReview, inferDomainPattern, patternGuess, displayPersonKey and generic-mailbox guards. Pattern support uses only already-T1 samples, rejects conflicting formats/ambiguous ownership and declines evidence sets beyond the existing 40-sample/20-person bounds. It does not silently discard a conflicting owner on a duplicate address. Reply/hard-bounce inputs from email_outcomes are filtered by exact org/address. Existing Deep find formatEvidence remains an engine-local closure; this adapter reproduces its hard-negative/role exclusions through tier classification rather than exporting that closure or treating its boolean as proof of T1 provenance.

Tests were added before the production modules and first failed module loading. Three further behavioral probes failed first: duplicate-address owner conflicts, generic T1 role inboxes masquerading as named-person pattern samples, and oversized evidence hiding a conflicting format. All pass after narrow fixes. Forty-two new tests cover classification/adaptation; 63 focused tests pass including existing pattern/confidence/role regressions. All new addresses use example.com.

### Inventory: where verified-email decisions live today

| Decision path | Existing rule | Uses the new classifier after this checkpoint? |
| --- | --- | --- |
| _shared/leadReadiness.ts evaluateReadiness | Saved address appears in the supplied checker-valid list; other readiness facts still block | No; item 2 is pending |
| _shared/deepFind.ts verifiedEmailResult / formatEvidence / contactFormatEvidence | Checker status, outcome history, hosted-role exclusions and saved-source provenance | No; items 2–4 are pending |
| _shared/deepFindEffort.ts deepPhaseDecision | verifiedEmail affects whether deeper phases run | No; integration pending |
| src/lib/autopilotPicker.ts hasVerifiedEmail and PickerFilterBar | Stored readiness_missing does not contain verified_email and a saved address exists | No; item 2 is pending |
| _shared/emailPreSend.ts / emailOutcomeLookup.ts | Fresh hard-bounce/reply history, recent checks, syntax/DNS and existing worker precheck | No; existing send protection is unchanged |
| src/lib/emailVerification.ts and verification badges | Existing checked/replied/bounced outcome disclosures | No; integration pending |
| src/lib/bulkDraftTargets.ts / single-row composer selection | Saved address selection; does not yet enforce tiers | No; item 3 integration is pending |

No production entrypoint imports the new module yet. Classification/adapters are the item 1 foundation, not a claim that every consumer has switched. No auto-apply, auto-draft, send, first-email consent, follow-up enrollment or current readiness behavior changed. No new button/run type exists. There is no function/frontend deployment to perform for this isolated checkpoint.

## Why storage is required before safe integration

Item 11 asks for real hard-bounce rates by the tier **at the time an email was sent**, with T2 automatically disabled above its threshold. email_logs currently has neither a tier snapshot nor a sent_ok-at-send flag. Reclassifying old emails with today's evidence would relabel the denominator after replies/bounces, producing misleading safety metrics. Old sends must remain unclassified, never invented T1/T2/T3 history.

Items 7/11 also need the actual bounced message/mailbox, not merely an org/address. email_outcomes is unique on org/address/outcome and stores the latest event for that key; it has no sent-log FK. Joining every send to the same address against that org-level row can mark unrelated sends/mailboxes bounced. The learner already correlates a DSN to sent logs, so it can record a trusted timestamp on the exact matched log in the later implementation. That linkage is not built here.

The smallest storage change is nullable, service-written metadata on existing email_logs, not another table or a new scheduler. The proposed snapshot and per-log bounce stamp support items 7/11 and future reads in 2–4 without weakening current guards. They do **not** solve the lifetime-person fallback counter or the second-opinion credential/cap design; those remain unstarted and may need further reviewed storage. The existing org_api_settings provider constraint also lacks a vendor-neutral verifier slot, and usage_resources must not be changed under this brief. No provider/usage schema work was attempted.

## Proposed migration SQL — NOT APPLIED, NOT TYPE/DB EXECUTION TESTED

No migration file or executable refresh script was created. This SQL is review text only. It must receive independent review and a disposable transactional audit before Kevin separately approves any application. Production schema/grants were not queried. Nullable fields deliberately leave historical sends unclassified. No historical tier backfill is proposed.

```sql
BEGIN;
ALTER TABLE public.email_logs
  ADD COLUMN recipient_tier_at_send text,
  ADD COLUMN recipient_tier_basis text,
  ADD COLUMN recipient_tier_version smallint,
  ADD COLUMN recipient_was_sent_ok boolean,
  ADD COLUMN recipient_tier_recorded_at timestamptz,
  ADD COLUMN hard_bounced_at timestamptz,
  ADD CONSTRAINT email_logs_tier_snapshot_shape CHECK (
    (recipient_tier_at_send IS NULL AND recipient_tier_basis IS NULL
      AND recipient_tier_version IS NULL AND recipient_was_sent_ok IS NULL
      AND recipient_tier_recorded_at IS NULL)
    OR
    (recipient_tier_at_send IS NOT NULL AND recipient_tier_at_send IN ('T1','T2','T3')
      AND status IS NOT DISTINCT FROM 'sent' AND sent_at IS NOT NULL
      AND recipient_tier_basis IS NOT NULL AND recipient_tier_version = 1
      AND recipient_tier_version IS NOT NULL AND recipient_was_sent_ok IS NOT NULL
      AND recipient_tier_recorded_at IS NOT NULL AND recipient_tier_recorded_at >= sent_at
      AND (NOT recipient_was_sent_ok OR recipient_tier_at_send = 'T1')
      AND ((recipient_tier_at_send = 'T1' AND recipient_tier_basis IN
        ('checker_valid','replied','sent_ok','company_site','places','saved_non_guessed'))
        OR (recipient_tier_at_send = 'T2' AND recipient_tier_basis = 'supported_pattern')
        OR (recipient_tier_at_send = 'T3' AND recipient_tier_basis IN
          ('evidence_mismatch','role_review','pattern_paused','weak_evidence')))
      AND (recipient_tier_basis <> 'sent_ok' OR recipient_was_sent_ok))
  ),
  ADD CONSTRAINT email_logs_bounce_stamp_shape CHECK (
    hard_bounced_at IS NULL OR
    (status IS NOT DISTINCT FROM 'sent' AND sent_at IS NOT NULL AND hard_bounced_at >= sent_at)
  );

CREATE FUNCTION public.guard_email_log_recipient_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.recipient_tier_at_send IS NOT NULL OR NEW.recipient_tier_basis IS NOT NULL
        OR NEW.recipient_tier_version IS NOT NULL OR NEW.recipient_was_sent_ok IS NOT NULL
        OR NEW.recipient_tier_recorded_at IS NOT NULL OR NEW.hard_bounced_at IS NOT NULL
      THEN RAISE EXCEPTION 'Recipient evidence is service-written' USING ERRCODE = '42501'; END IF;
    ELSE
      IF ROW(NEW.recipient_tier_at_send, NEW.recipient_tier_basis, NEW.recipient_tier_version,
          NEW.recipient_was_sent_ok, NEW.recipient_tier_recorded_at, NEW.hard_bounced_at)
        IS DISTINCT FROM ROW(OLD.recipient_tier_at_send, OLD.recipient_tier_basis,
          OLD.recipient_tier_version, OLD.recipient_was_sent_ok,
          OLD.recipient_tier_recorded_at, OLD.hard_bounced_at)
      THEN RAISE EXCEPTION 'Recipient evidence is service-written' USING ERRCODE = '42501'; END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS NOT DISTINCT FROM 'sent' AND OLD.recipient_tier_at_send IS NULL
      AND NEW.recipient_tier_at_send IS NOT NULL
    THEN RAISE EXCEPTION 'Historical send tiers cannot be invented'; END IF;
    IF OLD.recipient_tier_at_send IS NOT NULL AND
      ROW(NEW.recipient_tier_at_send, NEW.recipient_tier_basis, NEW.recipient_tier_version,
          NEW.recipient_was_sent_ok, NEW.recipient_tier_recorded_at)
      IS DISTINCT FROM ROW(OLD.recipient_tier_at_send, OLD.recipient_tier_basis,
          OLD.recipient_tier_version, OLD.recipient_was_sent_ok, OLD.recipient_tier_recorded_at)
    THEN RAISE EXCEPTION 'Sent recipient tier is immutable'; END IF;
    IF OLD.hard_bounced_at IS NOT NULL AND NEW.hard_bounced_at IS DISTINCT FROM OLD.hard_bounced_at
    THEN RAISE EXCEPTION 'Recorded message bounce is immutable'; END IF;
    IF (OLD.recipient_tier_at_send IS NOT NULL OR OLD.hard_bounced_at IS NOT NULL) AND
      ROW(NEW.org_id, NEW.sent_by, NEW.to_email, NEW.sent_at, NEW.message_id, NEW.status)
      IS DISTINCT FROM ROW(OLD.org_id, OLD.sent_by, OLD.to_email, OLD.sent_at, OLD.message_id, OLD.status)
    THEN RAISE EXCEPTION 'Recipient evidence cannot move to another send'; END IF;
  END IF;
  IF NEW.hard_bounced_at > clock_timestamp() + interval '5 minutes'
    OR NEW.recipient_tier_recorded_at > clock_timestamp() + interval '5 minutes'
  THEN RAISE EXCEPTION 'Future recipient evidence is invalid'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_email_log_recipient_evidence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_email_log_recipient_evidence() TO service_role;
CREATE TRIGGER email_logs_recipient_evidence_guard
  BEFORE INSERT OR UPDATE ON public.email_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_email_log_recipient_evidence();
CREATE INDEX email_logs_mailbox_reputation_window
  ON public.email_logs(org_id, sent_by, sent_at DESC) WHERE status = 'sent';
COMMIT;
```

Existing browser table privileges are intentionally not treated as protection for the new columns: the trigger must reject client insertion/update of evidence while allowing existing ordinary draft operations. The later server send implementation must compute the snapshot internally only on successful sends, and the bounce learner must stamp only the correlated sent log, idempotently. Neither integration exists yet. Keeping recipients/status/message IDs immutable after attribution is necessary for trustworthy rates, but compatibility with draft cleanup, legacy admin maintenance and future retention/deletion requires review. Foreign-key SET NULL on lead/contact attribution is not blocked by this guard; the mailbox/org/address/send identifiers remain fixed. Deleting an email log still removes history under existing policies; a tamper-proof lifetime ledger is not claimed.

Required audit cases before application: authenticated/anon cannot forge any new field; ordinary own draft insert/edit/delete remains allowed; service successful-send snapshot works; failed sends cannot carry a snapshot; legacy null rows remain valid; partial snapshots fail; T1/T2/T3 basis combinations and sent_ok flags are checked; captured tier and message identity cannot change; correlated hard-bounce stamp can be recorded once and reused without duplication; wrong/future/pre-send bounce timestamps fail; org access remains unchanged. The audit should be a rolled-back disposable fixture with the project's sentinel pattern. It has not been written or executed here.

## Remaining ordered work and resume point

| Item | State |
| --- | --- |
| 1 | Pure tier policy/adapters/tests and decision-site inventory built; no live consumer integration |
| 2 | Unstarted: readiness/company name/sendable_email compatibility, counts, picker/filters and assessment-change report |
| 3 | Unstarted: conservative auto-apply, provenance, first-email selection independent of follow-up consent and lead notes |
| 4 | Unstarted: actual 72-hour sent_ok derivation and format-evidence ingestion; the classifier only accepts a supplied fact |
| 5 | Unstarted: bounded lifetime person/format fallback tracking and reviewed queue drafts |
| 6 | Unstarted: Low/all-effort company web proof, separate allowance, matching safeguards and cost analysis |
| 7 | Unstarted: mailbox reputation calculation, bulk/fallback pause and explicit resume |
| 8 | Unstarted: Needs a look pipeline/queue filters and bulk actions |
| 9 | Unstarted: primary-source licence/capacity/risk/coverage research; nothing installed and no gain estimate invented |
| 10 | Partial checkpoint report only; final per-item/capacity/deploy report is not complete |
| 11 | Unstarted: real per-tier/sent_ok analytics and automatic T2 confidence downgrade |
| 12 | Unstarted: disabled vendor-neutral BYO verifier, org-only credentials/cap reservation and evaluation-harness description |

Resume with Claude's review of item 1 and this SQL dependency. Kevin must separately authorise any reviewed migration application and continuation after the requested SQL stop. Do not assume this report permits applying SQL or activating tier-based automation. The unbuilt vendor spike and hypothetical cost/coverage gains are not endorsements.

Preliminary capacity facts only (not a completed item 10): two 50-lead runs admit 100 leads, not 100 guaranteed recipients. Code defaults include 600 org / 1,200 shared daily worker checks; at ten actual checks per lead the org allowance covers only sixty fully checked leads, while averages of six or fewer could cover 100 before other caps. Scrape defaults are 100/org/day; fetches 300/org/day; effort policies also have per-run AI/Hunter caps. Actual organisation settings, remaining Hunter credits, send limits, evidence yields and provider latency were not read, so no single binding cap or promised 100-send capacity is asserted. Those require item 10 and approved runtime evidence.

## Gates, limits and final state

Final local gates: **241 files / 3,145 passed / one skipped / zero failures**, raw JSON success=true. TypeScript, production build (existing chunk warning), 25-entrypoint local edge shim and whitespace pass. Commands used VITE_SUPABASE_URL=http://127.0.0.1:54321 and VITE_SUPABASE_ANON_KEY=local-test-placeholder. Ignored raw evidence: .superpowers/pipeline-tighten-tests.json. The shim covers existing entrypoints; no entrypoint imports these new modules. Their strict types are checked through their tests' TypeScript imports. No new dependency or component was added.

The pure policy has no imports; all imports in the adapter resolve to existing pure rules. Deno, browser, production database/RLS/SQL/concurrency, real checker/sends and independent Claude review remain unverified. SQL is draft review text, not a tested migration. No push, merge, deploy, migration/SQL execution, real mailbox/provider/send, secret or paid fallback use, worker/VPS/usage_resources change, other-checkout edit or vault sync occurred. No auto-send or enrollment action occurred. Caveman remains active. Subscription usage is unavailable; no usage percentage or allowance exhaustion is claimed. No background jobs remain. Stop at this completed item-1 boundary because of the mandatory SQL instruction.


## Continuation after migration 074 (2026-11-11)

Kevin approved item 1 and reported migration 074 applied, saved in supabase/migrations/074_email_log_tier_snapshot.sql at 893d613. That is supplied rollout evidence, not a database check by Codex. The former global SQL stop is superseded: uncovered lifetime-fallback/vendor schema is report-only while other items continue. No SQL execution, push, merge or deployment is authorised.

### Item 2 — readiness redefinition

Ready now requires a company name and at least one saved live T1/T2 recipient. Person, website and company-match details remain informational; website suspicion or a foreign-phone mismatch still force needs_work. New assessments use sendable_email; old verified_email keys still display/read correctly. Missing company name has an explicit company_name key. Deep find reason counts use the shared classifier/formatter; badges without a persisted count still show their known informational reasons. Pipeline filters/sorts continue using the stored readiness status; picker now tests both old/new missing keys and says Has a sendable email. Existing rows do not magically reassess. The supplied 51-lead aggregate cannot establish the new per-lead distribution: some of the 14 almost and 32 needs_work rows may become ready when only informational facts were missing, but lack of a T1/T2 address, company name or mismatch still prevents readiness. No production rows were read and no new counts are invented.

Four tests failed before the new rule; updated legacy tests retain the informational assertions under the changed readiness semantics. Targeted readiness/picker tests pass. Item 3 will feed broader trusted evidence into the engine; this commit's compatibility path still accepts the engine's existing checker-valid list.

## Item 3 — supported recipients and first-email drafts

Deep find now classifies bounded address evidence before blank-only automatic email fills. T1/T2 fills create a plain lead note; T3/never and dismissed suggestions remain unapplied. The lead email is filled first when empty. Otherwise a supported contact can become primary without replacing an existing primary or changing `include_in_sequences`. Existing blank-value compare-and-swap and Undo records remain in use. Evidence is retained in existing run JSON. No sequence enrollment is added.

Bulk drafting chooses the primary contact for the first email even when follow-up enrollment is off. The generation endpoint independently reads org-scoped facts and rejects T3/never bulk targets. Existing manual primary choices are preserved; an unsafe existing primary may therefore require review instead of being silently replaced. A complete evidence read is required; oversized bounded histories fail closed.

Tests were added before the helper and evidence reader; the primary-contact regression also proves enrollment remains off. Focused recipient/target tests: 11 passed. Frontend TypeScript and the 25-entrypoint edge shim passed. Browser, live DNS/provider, database concurrency and independent review remain unverified. Deploy list: `deep-find`, `generate-email`, frontend (after review and separate authorization).

## Item 4 — delivered evidence and migration 074 integration

`sent_ok` is derived from genuine sent logs at least 72 hours old, with no exact-log or org/address hard bounce. A later hard bounce revokes it. Delivered samples feed the existing domain-format evidence; Deep find and bulk drafting use the same T1 basis. Reads currently decline incomplete bounded evidence rather than guessing.

The common SMTP boundary writes all five tier snapshot fields in the **same INSERT or UPDATE** as `status='sent'` and `sent_at`. Failed sends receive no snapshot. Manual overrides retain weak T3 evidence instead of gaining T1. No historical tier is backfilled. Migration 074 is used as supplied; Codex did not apply or modify it.

Bounce learning retains address-wide suppression but stamps `hard_bounced_at` only when a DSN identifies exactly one matching sent log. The write is scoped to its id, org, sender and sent status, conditioned on a null stamp. Repeated DSNs preserve the first timestamp. Ambiguous unthreaded DSNs do not invent per-send attribution.

Tests first: pure 72-hour boundary, negatives, complete snapshot, exact threaded match, duplicate DSN and ambiguous unthreaded attribution; the successful draft regression proves one mutation carries both send state and snapshot. Focused tests: 23 passed. The edge shim passed. Real trigger execution and mailbox/provider validation remain for Claude. Deploy union adds `send-email`, `process-autopilot`, `check-replies` and any entrypoint importing the shared sender/learner; exact final union will be recorded at item 10.

## Item 5 — fallback policy; schema-dependent queue deferred

The tested planner chooses only formats ranked after the bounced guess, excludes bounced formats, refuses non-guesses and refuses a third lifetime fallback. Its queue boundary requires both reputation permission and a successful durable save. There is no in-memory lifetime counter and no automatic send. Two focused tests pass after the missing-module red test.

**Not enabled:** production 074 does not contain a durable lifetime counter. Automatic bounce-to-draft orchestration is deferred with that schema; normal bounce learning continues. This is a schema boundary, not a claim that fallback drafts are being created. The following proposed SQL is report text only, not applied. The architect must review the canonical person key (company domain plus normalized full identity, independent of contact-row id), original guessed-send provenance, and connect the service-only transaction to the planner after approval. Deleting drafts must never reset the lifetime count.

```sql
create table public.email_fallback_attempts (
  org_id uuid not null references public.organisations(id),
  person_key text not null check (length(person_key) between 3 and 400),
  source_log_id uuid not null,
  draft_log_id uuid,
  address text not null,
  created_at timestamptz not null default now(),
  primary key (org_id, person_key, source_log_id)
);
alter table public.email_fallback_attempts enable row level security;
revoke all on public.email_fallback_attempts from public, anon, authenticated;
grant select, insert on public.email_fallback_attempts to service_role;
-- No cascading deletion: these records enforce a lifetime limit.
create function public.queue_email_fallback(
 p_source uuid, p_person_key text, p_address text
) returns uuid language plpgsql security definer set search_path = public as $$
declare s email_logs%rowtype; d uuid;
begin
 if auth.role() <> 'service_role' then raise exception 'Service only'; end if;
 select * into strict s from email_logs where id=p_source for update;
 if s.status <> 'sent' or s.hard_bounced_at is null
    or s.recipient_tier_basis <> 'supported_pattern'
    or s.decision_maker_candidate_id is null then
   raise exception 'A matched guessed send and named person are required';
 end if;
 -- Before rollout: validate p_person_key against the source contact's canonical
 -- full name and company domain, and reject dismissed/obfuscated/opted-out contacts.
 -- Validate the next-ranked address and current bounce/blocklist/reputation facts
 -- server-side. This incomplete proposal must not be applied before those checks.
 perform pg_advisory_xact_lock(hashtextextended(s.org_id::text || ':' || p_person_key, 0));
 if exists(select 1 from email_fallback_attempts where org_id=s.org_id
   and person_key=p_person_key and source_log_id=p_source) then return null; end if;
 if (select count(*) from email_fallback_attempts where org_id=s.org_id
   and person_key=p_person_key) >= 2 then return null; end if;
 insert into email_logs(org_id,lead_id,sent_by,to_email,subject,body,status,decision_maker_candidate_id)
 values(s.org_id,s.lead_id,s.sent_by,p_address,s.subject,s.body,'draft',s.decision_maker_candidate_id)
 returning id into d;
 insert into email_fallback_attempts(org_id,person_key,source_log_id,draft_log_id,address)
 values(s.org_id,p_person_key,p_source,d,p_address);
 return d;
end $$;
revoke all on function public.queue_email_fallback(uuid,text,text) from public,anon,authenticated;
grant execute on function public.queue_email_fallback(uuid,text,text) to service_role;
```

This is an explicitly incomplete review proposal, not rollout-ready migration SQL. No migration file was added. The remaining items continue under Kevin's latest instruction. No deploy entrypoint is added by the dormant pure planner.

## Item 6 — company web proof at every effort

Low and Custom now join Medium/High/Extra high for unresolved UK company proof. One grounded call per lead is reserved durably in the existing run JSON, capped at 50 per run. It is separate from drafting and exploratory Deep find AI credits; it does not change `usage_resources`. The existing result compare-and-swap preserves this allowance alongside checker state. Reservations are not refunded after an attempted call or uncertain failure, so retries cannot silently double spend.

A grounded number can auto-pick only a unique plausible active company present in the Companies House search results, with matching name and matching location when supplied. Two plausible active matches, mismatched names, absent search numbers and dissolved companies remain for human choice. Missing Gemini key, exhausted allowance, unavailable reservation or insufficient remaining time produces a plain skip line and does not fail the run. The existing Companies House key remains required.

Tests first covered all efforts and the stricter grounded pick. Focused registry tests: 74 passed (including separate allowance/retry/cap coverage). Edge shim passed. Cost for 100 leads requires 100 grounded requests plus model tokens; current official pricing is linked in the final research/capacity section. This is an estimate, not a live billing measurement. Deploy: `deep-find` only. No provider call or live reservation was made.
