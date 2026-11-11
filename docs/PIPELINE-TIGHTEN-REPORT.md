> **Current checkpoint (2026-11-11):** continuation items 2–12 handled locally; see the final report section below. Item 5 automatic fallback and item 12 storage/quota integration remain explicitly deferred for uncovered schema. Migration 074 was supplied as applied and is used without alteration. Final gates: 3,182 passed, one skipped; TypeScript/build/28-entrypoint edge shim/whitespace pass. Historical item-1-only stop text below is superseded by Kevin's continuation instruction. No publication or SQL execution occurred.
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
  org_id uuid not null references public.organizations(id),
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
 if auth.role() is distinct from 'service_role' then raise exception 'Service only'; end if;
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

## Item 7 — mailbox reputation guard

Bulk release checks the sending user's mailbox in the draft's organisation on every send. At least 20 genuine sends in the last 7 days and hard bounces on at least 5% pause the batch. Numerator uses exact-log `hard_bounced_at`; ambiguous historical DSNs cannot be assigned to arbitrary sends, so old unattributed bounces are not invented. Missing/incomplete safety evidence pauses bulk release. Ordered pagination avoids the API's default row limit.

Waiting to release has an explicit acknowledgement checkbox and a stronger confirmation for knowingly resuming one batch. It resets after the batch. This acknowledgement cannot override T3, hard bounce, opt-out or blocklist checks. Manual single sends bypass only the reputation gate. The dormant fallback boundary also requires reputation permission; automatic fallback creation remains schema-blocked under item 5.

Focused threshold/send-boundary tests: 8 passed, including 20-send/5%, fewer than 20, mailbox/time isolation, manual single sending and weak-tier refusal after acknowledgement. Frontend TypeScript and edge shim passed after correcting the item 6 fixture type. No database/provider/browser test occurred. Deploy: frontend and `send-email`; shared sender consumers inherit the guard when explicitly using bulk release.

## Item 8 — Needs a look in existing lists

Pipeline List and Waiting to release now have a `Needs a look` toggle. It combines existing missing-sendable/readiness facts, weak-only tier evidence, unresolved company candidates, suspect websites and saved recipients all present in hard-bounce history. It does not add a screen or automation. Pipeline selection keeps the existing bulk Deep find/draft/profile controls; Waiting to release retains `useReviewBatch` and its existing bulk release/reject controls. Unsafe recipients still require individual review because the server enforces tiers independently.

The hints are org-scoped, bounded and read-only. Failed or incomplete hint reads show a warning and retain known readiness-based hints; the filter is a review aid, not an authorization gate. An alternative safe address prevents the bounced-only reason. Existing informational flags do not alone block readiness.

Tests first: review reasons and a safe alternative; combined filter tests 14 passed. TypeScript passed. Browser/phone/theme, RLS and large-history usability remain unverified. Deploy: frontend only. No new component or dependency.

## Item 9 — public-source evidence spike (report only, 2026-11-11)

No software was installed and no VPS/provider account was accessed. Estimates below are hypotheses, not measured gains. A third-party page or search snippet alone does not make an address company-published T1: retain URL/time/provenance, visit the company's own source where possible, and apply the same tier, suppression and role-mailbox rules.

| Option | Increment beyond current tools | Licence and operational risk | Recommendation and estimated incremental T1 coverage |
|---|---|---|---|
| SearXNG querying `"@domain"` | Finds indexed PDFs, old company pages and URLs outside the worker's current page shortlist; may diversify Gemini search results. It does not verify mailboxes or crawl an independent web index. | AGPL-3.0-or-later; preserve licence/source obligations for any modifications. Its documented JSON search interface requires enabling the output format. Upstream engines can block or challenge the VPS IP. | First candidate for a later controlled experiment, not rollout now. Hypothesis: 0–5 percentage points across comparable UK leads, including zero. Deduplicate against existing own-page and Gemini evidence. |
| theHarvester-style passive collection | Collects indexed addresses across multiple public sources; can discover old names/formats not present in Places, CH officers or current own-site pages. Much overlaps SearXNG/Gemini. | Maintainer README says GPL-2.0-only; review the pinned release because the licence file also contains generic later-version boilerplate. Sources can require paid keys or have restrictive terms. Passive collection only; disable DNS brute force, port scans and unrelated reconnaissance. | Do not add the complete reconnaissance tool to production. If the experiment finds a valuable source, add its narrow permitted connector behind the existing worker boundary. Hypothesis: 0–3 points beyond current sources; not additive to SearXNG. |
| Self-hosted Firecrawl | Broader same-site crawling and Markdown extraction can reach pages missed by the current shortlist. Existing worker already handles browser pages; existing Firecrawl client already provides a bounded fallback, so overlap is substantial. | AGPL-3.0-or-later. Current self-hosting guide requires several supporting services and separate production security/storage planning. Default stack lacks Fire-engine and advanced anti-bot/page-action capabilities. | Do not co-host the full stack on this shared VPS. Hypothesis: 0–3 points beyond the current worker/Firecrawl path. Prefer measuring missed own-site pages first. |

Primary sources: [SearXNG licence](https://github.com/searxng/searxng/blob/master/LICENSE), [search API](https://docs.searxng.org/dev/search_api.html), [upstream CAPTCHA operations](https://docs.searxng.org/admin/answer-captcha.html), [theHarvester maintainer README](https://github.com/laramies/theHarvester/blob/master/README.md), [licence](https://github.com/laramies/theHarvester/blob/master/LICENSE), [Firecrawl licence](https://github.com/firecrawl/firecrawl/blob/main/LICENSE), [self-hosting and limitations](https://docs.firecrawl.dev/contributing/self-host).

Capacity: local runbook records KVM 2, 2 vCPU/8 GB, with historical October utilisation only. Repository worker Compose already permits about 3,200 MiB and 2.75 aggregate CPU across containers, including two browser jobs. These are ceilings, not current consumption; n8n/Traefik and the OS also share the host. No current free-capacity claim is possible without separate authorised measurements. A later SearXNG pilot could start with an engineering budget of 512 MiB, 0.25 CPU and one query at a time; that is a proposed cap, not an upstream guaranteed minimum. Browser crawling could exhaust CPU before RAM. No new task should weaken n8n isolation or worker SSRF protections.

Cost: software licence fees are zero for these open-source deployments, but hosting headroom, patching, upstream keys, permitted search API usage, storage and maintenance are not free. Existing VPS subscription cost is unchanged only if measured spare capacity supports the pilot; no current upgrade quote was obtained. Never buy proxies or bypass upstream restrictions to turn a blocked source into a dependency.

Privacy/terms: domain and person queries reach upstream engines; harvested employee addresses can be personal data even when public. Retain minimal business evidence, honour erasure/opt-out and source terms/robots, avoid sensitive data and do not treat publication as outreach consent. Review-before-send remains. Provider sign-in/login enumeration is excluded. Before any pilot, the architect should review licences and data handling for the exact pinned versions and sources.

Validation proposal: a fixed 100-lead, org-authorised sample; compare existing evidence with each added source, count unique newly supported T1 people, source ownership, stale-address rate, cost and latency. Evaluate send outcomes only through normal human-reviewed outreach. Gains overlap; no combined uplift or extra daily send capacity is claimed.

## Item 10 — capacity and integration checkpoint

This section supersedes the historical item-1-only status table and SQL stop above. Items 2–4 and 6–9 are built locally. Item 5's durable automatic queue is deferred for uncovered schema. Items 11–12 follow this checkpoint. Migration 074 already exists and is applied according to Kevin; it is not a new rollout action for Codex.

Integration verification: 250 test files, 3,167 passed and one skipped; zero failures. TypeScript, production build, 25-entrypoint edge shim and whitespace pass. The build retains the existing large-chunk warning. Full tests first exposed incomplete fake database builders and stale expectations for readiness, first-recipient fills, CH search provenance and bounce stamps. Fixtures now exercise the new reads and expected behavior. A new red regression found that manual invalid overrides needed the allowed T3 `weak_evidence` basis under 074; that is corrected. Ambiguous full names and replacements for typed invalid contact addresses remain review-only, including when the lead's email is empty. New DNS work is mocked in engine tests; no real provider was contacted.

### End-to-end daily capacity

| Stage | Current local limits and implication for two runs of 50 |
|---|---|
| Deep find admission | 50/run, 200/org/day, 5/same lead/day. Two new 50-lead batches fit admission, not necessarily evidence yield or wall time. |
| Worker checks | 600/org/day, 1,200 shared/day; at most 10/lead and 8/domain. Ten actual calls on each lead uses all 600 after 60 leads. At six per lead, 100 consumes the whole org allowance, leaving no fresh pre-send checks. Cached/replied/sent_ok evidence can reduce calls. Shared use by other orgs can bind sooner. |
| Browser scrapes / page fetches | 100/300 per org/day, shared global ceilings 400/1,000. One browser scrape per lead exhausts the daily scrape allowance at 100; retries or extra domains reduce that. |
| Hunter | Low 0; Medium 1; High 3; Extra high 6 per lead; whole-run cap 500. For 100 leads nominal ceilings are 0/100/300/600 credits before remaining monthly account credits and per-step stopping. Actual credits were not queried. |
| Exploratory AI | Low 0; Medium 2; High 4; Extra high 8 per lead; cap 200/run. Fifty High leads consume up to 200; fifty Extra high leads cannot all receive their maximum. Drafting has its existing independent key/cost path. |
| Company proof | Separate one/lead, at most 50/run, hence at most 100 attempted proof calls for two runs. Unresolved UK leads only; no key/time/allowance means a visible skip. Confirmation now discloses this separately, including on Low. |
| Other providers | Firecrawl 100 pages/org/day, Places 300 lookups/org/day, Apollo phone 100 enrichments/org/day. Keys, actual account allowances and remaining usage may bind sooner. |
| Sending | Existing Autopilot run send cap is user-selected, maximum 200, inside its existing window/Pause/Stop rules. Two runs of 50 do not create or raise a mailbox/provider allowance. Ordinary manually reviewed `send-email`/Waiting-to-release calls do not use an Autopilot run's window or counter; this task preserves that existing architecture and adds the bulk reputation/tier gates. No provider sending quota was read. |

Under worst-case ten-check discovery, worker verification binds first at 60 fully checked leads, before allowing fresh send checks. With strong cached evidence, scrape allowance, monthly Hunter credits, exploratory AI cap, mailbox reputation or the actual provider send quota may bind first. There is no honest unconditional promise of 100 sends/day. One first recipient per company is assumed; including extra contacts increases draft/send demand without increasing the 100-lead admission figure.

### Grounded proof estimate for 100 leads

The repository uses `gemini-3.6-flash`. On the checked official Standard pricing page, current promotional input/output prices are $0.75/$3.75 per million tokens through 2026-12-31, then $1.50/$7.50. Assuming 2,000 input and 500 output tokens per lead, 100 calls cost about **$0.3375** in model tokens now ($0.675 at the stated later rates). Google Search includes 5,000 monthly search requests shared across Gemini 3+ models, then $14/1,000 requests. At one billable search query per call, 100 calls add $1.40 after the shared free allowance: about **$1.74 total**, or about $0.34 while that allowance remains. A call can issue multiple billable search queries; output/thinking tokens also vary, so this is not a hard cost cap. Missing key or allowance skips proof with one plain line, never a substitute paid provider. Source: [Google official Gemini pricing](https://aistudio.google.com/docs/pricing#gemini-3.6-flash), checked 2026-11-11.

### Reassessment of the 51 assessed leads

No live lead was read or changed. The old 37 website and four decision-maker deficiencies become informational. The 40 legacy `verified_email` deficiencies need reassessment against saved T1/T2 evidence; they are not automatically 40 improvements. Company-name plus supported-recipient leads can become ready despite those informational flags; suspect websites and foreign-phone mismatch remain needs-work. Conflicting company candidates remain in Needs a look. Exact revised counts cannot be reconstructed from the aggregate 5/14/32 alone. The 294 never-assessed leads stay unassessed until a normal Deep find.

### Rollout and limitations

Current deployment union, after independent review and separate authorisation: frontend, `run-deep-find`, `generate-email`, `send-email`, `run-autopilot`, `run-selected-autopilot`, `check-replies` and `email-outcome-backfill` if present in the final import graph. The final report will confirm entrypoint names after items 11/12. No SQL, deployment, real send, worker/VPS change, new dependency, key read or account spend occurred. Database constraints/concurrency, Deno proper, live provider/DNS, browser, phone width, themes, RLS and independent review remain unverified. Existing oversized components remain oversized; no new component has exceeded 150 lines. A broad unrelated component rewrite is not included.

Privacy reference for item 9: [ICO business-to-business marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/) explains that public business-contact personal data still carries data protection obligations. No legal-compliance claim is made for an unbuilt harvesting system.

## Item 11 — measured confidence

Analytics now shows organisation aggregate T1/T2/T3 and sent_ok sends, exact hard bounces and rates over the last 30 days. The `email-settings` action authenticates the user and verifies membership in the requested org before reading aggregate service-side metrics. No addresses are returned. Historical sends without a version-1 snapshot are explicitly unclassified, never backfilled; sent_ok is an overlapping T1 subset. Recent sends remain in the requested 30-day denominator and may still bounce later. Exact-log stamps come from the correlated outcome learner; ambiguous/unattributed DSNs are not joined onto every historical send.

The automatic rule is strict: **at least 30 recorded T2 sends and rate greater than 8%** downgrades supported guesses to T3. Exactly 8%, or fewer than 30 sends, does not pause T2. The rolling rate can recover as outcomes/window membership change. Deep find checks before automatic application; bulk generation and the common pre-send context recheck independently. The Analytics banner states the pause. An unavailable safety read declines automatic T2 use; it does not promote a candidate. Stored support samples are refreshed against current hard negatives before reuse; a once-strong sample cannot indefinitely support T2 after bouncing. Hosted/catch-all role evidence remains conservative.

Safety reads now use ordered 1,000-row pages, declining inconsistent counts/errors or more than 100,000 rows rather than silently trusting a partial set. Org outcome/send history in the recipient reader uses the same complete-read guard; per-lead provenance stays bounded. This is a conservative service limit and may require an aggregate RPC for very large org histories later.

Tests first: 29/30-send boundary, exactly/above 8%, recovery, real snapshots only, sent_ok subset, org/time/status isolation. Reader integration proves downgrade/recovery and revocation of a stored supporting sample. Pagination test covers 1,001 rows and read failure. Focused tests: 6 passed. TypeScript and 25-entrypoint edge shim passed. New Analytics component is under 150 lines. Deploy union adds `email-settings` and frontend; no new schema. No production metric or outcome was read. Browser/RLS/database concurrency remain unverified.

## Item 12 — disabled second-opinion seam and uncovered storage

`secondOpinion.ts` is OFF by default and has no production caller, vendor, network adapter or key-entry UI. It computes the original tier from trusted evidence and considers only T2 candidates whose own check is unresolved on hosted/unknown mail. An org-bound own key, positive integer daily cap and durable reservation must precede a call. Global/foreign credentials, settled own verdicts, opt-out, cap refusal and non-T2 candidates make no call. `email_verifier` is a typed org-only resolver slot; even a future global environment variable/fallback flag cannot supply its key.

A vendor valid result upgrades only with explicit non-catch-all proof and proven work. Invalid maps to never; risky/catch-all/unknown do not upgrade. Uncertain dispatch is charged conservatively; only proven no-work gets one refund attempt. Fake-provider tests verify ordering, default-off behavior, org isolation, verdicts, malformed proof and refund rules. No real vendor call, dependency, credential or spend occurred. The existing worker `reserveUsage`/`refundUsage` implementation is resource-typed for worker quotas; reusing those counters would violate the instruction not to touch `usage_resources`. The seam follows its reserve-before-call/refund-only-no-work pattern through injected methods. The actual external-verifier quota/storage adapter is deferred until the following uncovered schema is reviewed and applied.

### Proposed verifier storage SQL — report only, NOT APPLIED

This extends the existing org Vault-key slot pattern, with an independent service-only reservation ledger. It does not create a global key or alter worker resources. Any eventual settings action must be admin-only, preserve secret-redaction rules and remain disabled until Kevin approves the vendor and spending. Key validation must not fall through to Hunter's endpoint. No settings action or live quota adapter is enabled in this build.

```sql
begin;
alter table public.org_api_settings drop constraint org_api_settings_provider_check;
alter table public.org_api_settings add constraint org_api_settings_provider_check
 check(provider = any(array['gemini','google_places','google_places_pro','companies_house',
 'apollo','hunter','anthropic','opencorporates','cro','lookup_worker','firecrawl','email_verifier']));
create table public.email_verifier_limits (
 org_id uuid primary key references public.organizations(id),
 enabled boolean not null default false,
 daily_cap integer not null default 0 check(daily_cap between 0 and 1000)
);
create table public.email_verifier_reservations (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id),
 day date not null,
 refunded boolean not null default false,
 created_at timestamptz not null default now()
);
create index on public.email_verifier_reservations(org_id,day);
alter table public.email_verifier_limits enable row level security;
alter table public.email_verifier_reservations enable row level security;
revoke all on public.email_verifier_limits,public.email_verifier_reservations from public,anon,authenticated;
grant select,insert,update on public.email_verifier_limits,public.email_verifier_reservations to service_role;
create function public.reserve_email_verifier(p_org uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare limits public.email_verifier_limits%rowtype; token uuid;
 d date := (clock_timestamp() at time zone 'Europe/London')::date;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only'; end if;
 select * into limits from public.email_verifier_limits where org_id=p_org for update;
 if not found or not limits.enabled or limits.daily_cap < 1 then return null; end if;
 if (select count(*) from public.email_verifier_reservations
     where org_id=p_org and day=d and not refunded) >= limits.daily_cap then return null; end if;
 insert into public.email_verifier_reservations(org_id,day) values(p_org,d) returning id into token;
 return jsonb_build_object('orgId',p_org,'id',token,'day',d);
end $$;
create function public.refund_email_verifier(p_org uuid,p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare changed uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only'; end if;
 update public.email_verifier_reservations set refunded=true
 where id=p_id and org_id=p_org and not refunded returning id into changed;
 return changed is not null;
end $$;
revoke all on function public.reserve_email_verifier(uuid) from public,anon,authenticated;
revoke all on function public.refund_email_verifier(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_email_verifier(uuid) to service_role;
grant execute on function public.refund_email_verifier(uuid,uuid) to service_role;
commit;
```

Existing service-only `app_set_org_api_key` / `app_get_org_api_key` can store the future `email_verifier` secret with the existing org/provider Vault naming. Limits and ledger stay service-only; eventual settings writes require an authenticated org-admin check. Schema/RPC concurrency, retention and rolled-back audits require architect review before rollout. No migration file was added. Item 5's table reference is `public.organizations` (the actual repository table name); its incomplete proposal is not executable rollout SQL.

### Vendor evaluation harness (description only)

An offline-labelled CSV contains address, domain, known outcome, observed-at timestamp and actual send-time tier. After Kevin selects vendors, approves spending and enters their own keys outside chat, a local harness should: stratify/split domains to prevent leakage; deduplicate addresses; reserve a small explicit trial allowance; call each provider's documented verification API through an adapter; retain redacted verdict/latency/cost/proven-no-work metadata; map valid/invalid/risky/unknown consistently; and print confusion matrices, precision and recall per actual tier, hosted/catch-all segment and vendor. Report unknown/abstention coverage separately and do not treat absence of a hard bounce as infallible ground truth. Match a held-out outcome window and include delayed-bounce uncertainty. No login/sign-in enumeration or unsolicited test sends. This build does not execute or install the harness.

### Final integration recovery check

Inspection found selected Autopilot's old warning recovery wrote a new `sent_at` without tier evidence, including when the warning was only a checker-cache warning. The common sender now returns its original complete failed-log mutation internally. Recovery reuses that exact payload, so status, sent_at, message id and all 074 fields stay in one mutation; it never invents a later snapshot/time or rewrites a successfully logged send merely because verification warned. A red regression proved the complete recovery payload before the fix. This internal payload is not exposed by the HTTP response.

Analytics endpoint tests additionally prove authentication, exact org membership, aggregate-only output and fail-closed reads. The edge shim now covers 28 entrypoints, adding the three org-key consumers omitted by the prior 25-entrypoint check. Final gates and handoff follow below.

## Final local report — 2026-11-11

Kevin's continuation authorisation supersedes the original SQL-and-stop instruction. Item 1 remains the reviewed base; migration 074 is supplied as already applied. Items 2–12 were handled in order, tests first for testable behavior and one commit per item. Report-only research required no test. All implemented changes are local and await Claude's independent review.

| Item | Local result | Commit |
|---|---|---|
| 2 | Name plus saved T1/T2 readiness, informational secondary flags, legacy-key reads | c07d506 |
| 3 | Blank-only supported recipients, primary first-email selection and server bulk-draft tier check | 4b1672f |
| 4 | Read-time sent_ok, atomic 074 send snapshot and exact-log one-time hard-bounce stamp | 48e9bc3 |
| 5 | Tested fallback planner; automatic durable queue deferred for lifetime schema | fd663cb |
| 6 | All-effort company proof with separate durable run allowance and conservative grounded pick | b86c788 |
| 7 | Bulk mailbox reputation pause and one-batch explicit resume; manual single exempt | 512e67a |
| 8 | Needs a look filters in existing Pipeline List and Waiting to release | 365a50d |
| 9 | Primary-source evidence/licence/VPS spike, report only | 9ce4637 |
| 10 | Capacity, cost, integration fixture updates and report checkpoint | ce79149 |
| 11 | Actual send-time tier analytics and rolling T2 confidence guard | fda7f8a |
| 12 | Disabled tested provider seam, BYO-only resolver slot and report-only quota/key SQL | Final item commit carries this report |

**Deferred, not operational:** item 5's bounce-to-draft orchestrator cannot safely create drafts until the reviewed lifetime-person ledger/transaction exists. Item 12's credential settings and atomic org quota adapter cannot be connected until its schema and a vendor are approved. Their SQL/proposals are report-only, not applied, not migration files and not database-tested. The fallback SQL is explicitly incomplete pending identity/provenance checks and audit; do not paste it into production. Other items did not stop at those schema boundaries.

Final gates on the complete application tree: **254 test files; 3,182 passed, one skipped, zero failed**. `npx tsc --noEmit`, `npm run build`, expanded 28-entrypoint `node scripts/places-edge-typecheck.mjs` and `git diff --check` pass. Local test environment used only `http://127.0.0.1:54321` and a placeholder anon value; fake database/provider fixtures performed no external work. The build retains its pre-existing large-chunk warning. Test JSON remains in gitignored `.superpowers/pipeline-tighten-final-gates.json`.

Exact transitive changed-module deployment union (22 functions), if separately reviewed and authorised: `check-replies`, `check-sequences`, `draft-linkedin-message`, `draft-reply`, `email-settings`, `enrich-apollo`, `enrich-hunter`, `enrich-leads-bulk`, `find-decision-makers`, `generate-email`, `parse-csv-leads`, `parse-icp`, `parse-notes`, `parse-session-notes`, `run-deep-find`, `run-lookup-jobs`, `run-selected-autopilot`, `scrape-companies-house`, `scrape-cro`, `scrape-google-places`, `send-email`, `suggest-sequence`; plus frontend. Most broad consumers share `orgApiKeys`; their existing providers retain their behavior. `run-autopilot` is not in this import union, and there is no standalone `email-outcome-backfill` entrypoint: backfill runs through `email-settings`. This corrects the preliminary item 4/10 names. No migration or worker deployment is part of this local handoff.

Remaining validation: independent Claude review; real Deno runtime; disposable database constraint/trigger/RLS and race audits; live DSN/mailbox correlation; real DNS/provider latency; browser/keyboard/phone/light/dark checks; real account allowance and billing observations. Historical unclassified sends and ambiguous DSNs limit measurement coverage. The new filters are bounded review hints and can be stale; server decisions recheck facts. Very large complete-read histories fail closed. Existing oversized components were not broadly refactored; the newly added Analytics component is under 150 lines.

No push, merge, deployment, migration/SQL execution, production read/write, real send, provider spend, worker/VPS change, `usage_resources` edit, dependency change, other-checkout edit or vault sync occurred. Hooks were disabled for commits as requested. Codex remains builder; Claude remains architect/reviewer. Builder stops after this report and final handoff. Next action is Claude review, with particular attention to 074 atomic writes/recovery, tier evidence provenance, exact DSN attribution, quota boundaries and the two schema-dependent deferrals.

Final audit addendum: new evidence paths now include the complete org-wide outreach blocklist (exact address, domain and parent domain), alongside lead-specific blocked domains. The same blocklist gates existing early Deep find blank email writes, not only final tier selection. Red regressions demonstrated that strong saved/checker evidence could otherwise escape that org block; reader and real-engine tests now pass. Final Deep find tier evaluation also shares one MX lookup per domain instead of repeating DNS for every sample. These corrections are included in the final item-12 integration commit. The complete gates were rerun afterward: 254 files / 3,182 passed, one skipped; TypeScript/build/28-entrypoint edge shim/whitespace pass.
