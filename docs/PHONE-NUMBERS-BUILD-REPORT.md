# Phone numbers — local build report

Date: 2026-10-26. Builder: Codex. Architect/reviewer: Claude (review pending).

## Scope and revision

Built in `C:/Users/kevin/Projects/dreamlabs-sales-phone`, branch `codex/phone-numbers`, from clean baseline `4d8cd004b48c97845d100398ab630819b22b8935`.
Approved requirements: `docs/superpowers/specs/2026-10-22-phone-numbers-design.md` and `docs/PHONE-NUMBERS-BUILD-BRIEF.md`.
Final tested code revision: `1774e5bc26477a794aedc07b1bac41c44efb9416`. A documentation-only commit follows this revision.

No push, merge, deployment, migration application, SQL/audit execution, remote write, provider lookup, call, SMS, email or message occurred. No real credentials were used. No other checkout or MD-import feature file was edited. No vault synchronization ran; commit hooks were disabled per the brief so branch documents could not overwrite accepted vault references. Subscription usage is not exposed; no percentage is estimated.

The only dependency addition was the approved `libphonenumber-js`. Offline installation first returned `ENOTCACHED`; the explicitly permitted npm installation then succeeded. Application/provider services were never contacted.

## Built

- Shared, pure `_shared/phoneNumbers.ts`: E.164 parsing with a country default; GB, IE and US fixtures; AE/SA parsing ready for the separate Gulf work; mobile/landline classification where the numbering plan distinguishes them; ambiguous US types remain unknown. Dates, postcodes, repeated digits, prose and malformed phone shapes are rejected. Existing number text is not destroyed.
- `libphonenumber-js` is pinned to **1.13.15**, using full metadata from `/max`. Deno uses `npm:libphonenumber-js@1.13.15/max`; Vite/Vitest resolve that exact specifier to the installed package, and both local TypeScript configurations map its declarations. This avoids separate browser and edge implementations. Deno resolution itself has not been exercised locally.
- Migration `068_phone_metadata.sql` and its rollback audit are written only. The migration adds the four contact columns and `leads.phone_meta`, backfills legacy values as unknown/manual, preserves phone columns, and adds metadata-maintenance triggers. It changes no existing RLS policy, existing column grant or provider guard. Only the four new contact metadata columns receive an additive authenticated UPDATE grant under the existing edit policy.
- Deep find reuses already-fetched, confirmed company pages. The page reader now captures actual final source URLs during its existing requests. A phone beside the whole person's name in the smallest supported staff block becomes a direct-line suggestion. Unrelated blocks, scripts, footers, social sites and listed data aggregators do not establish a direct phone. Worker responses contain phone/source pairs rather than staff HTML, so their phones are company-line fallbacks, never fabricated direct lines. No extra page request was added for phones.
- Person phones use a distinct `person_phone` suggestion with Add/Dismiss. They never automatically update a contact. Missing, filled, dismissed and ambiguous people are handled explicitly. Shared switchboard dismissals are scoped to the person. The defensive result parser retains validated phone evidence, and session/RLS writes compare the contact's previous blank phone before saving.
- Original sourced text is retained in proposal evidence and the owning lead's per-number JSON before writing a normalized contact phone. Existing lead-line labels take precedence when the same number has another relationship on a person. Metadata may retain historical/contact-only keys; filters examine only current lead/additional/live-contact phone values.
- Existing Phase 3 lead blank fills and Undo remain. The old plausibility gate moved unchanged into the shared module, while normalization remains separate. Places automatic phone fills retain provenance and normalize their saved value. Regression coverage proves Undo still suppresses a subsequently returned national-format equivalent.
- Apollo phone reveal requires an explicit per-person click and the organisation's own configured Vault key, with no global-key fallback. The action says **“Reveal phone (uses your Apollo credits)”**. A missing phone makes this the prominent paid action; an existing phone disables it. Keyless organisations see a setup explanation. The same control is used in contact and bulk-review views.
- Named business contacts without an Apollo person ID can use the existing people/match path with full name and company domain. Phone requests reserve `pending` before spending so duplicate clicks cannot repeat the reveal. A provider failure permits an explicit retry. A fast callback cannot be overwritten back to pending. Callback writes preserve manual fills and dismissed people, normalize usable provider numbers, store Apollo source metadata/original text, and report database failures for retry.
- Phone chips appear on lead cards, lead details, additional phones and contacts. They show an honest kind label, normalized `tel:` target, source tooltip and keyboard/touch-accessible source disclosure. Invalid numbers have no calling link. Wrapping, focus styles and 44px action controls are retained.
- Pipeline list filters **Has phone** and **Has direct line** include lead numbers, additional numbers and RLS-visible live contacts. Explicit direct/mobile metadata qualifies for the direct-line filter; company/unknown labels do not. Contact changes refresh the pipeline data through the existing published contact table.
- Power Dialer receives normalized E.164 primary numbers, excludes junk, preserves stored originals, and remains unable to start automated calling. UK TPS/CTPS and opt-out reminders appear before cold calling. Users can explicitly flag a number as belonging to a sole trader or partnership; a missing company registration never invents that flag.

## Decisions and limitations requiring review

1. **Apollo allowance balance:** the existing integration exposes whether the organisation has a key, not its remaining phone-credit balance. No new, unverified provider API was introduced. The real UI explicitly says to check remaining credits in the organisation's Apollo account; it does not invent a numeric allowance. The component accepts a numeric balance, but no existing data source supplies one. A live numeric allowance is therefore **not implemented** and needs the architect's ruling/provider research before this requirement can be considered fully satisfied.
2. **No independent review yet.** The build and gates are local evidence, not Claude's approval. Do not merge until Claude reviews the exact code revision and the unapplied migration/audit.
3. **Original-text storage:** use the approved existing JSON column for contact number originals rather than adding an unapproved fifth contact column. Evidence is saved before the contact write. If the subsequent contact write is blocked or raced, harmless metadata history may remain; it does not create a callable contact or enrol anyone. Existing lead-line metadata is preserved when a person's number is the same number.
4. **Legacy key conversion:** migration SQL conservatively derives canonical keys for legacy international/GB/IE/US text. It does not rewrite original numbers or act as a validation/calling gate. Unconvertible legacy text stays in the existing phone fields. Runtime parsing and classification use the shared library.
5. **Country scope:** null retains the repository's GB default; OTHER requires an explicit international prefix. AE/SA are parser-ready, but the separate country selector/schema expansion is not part of this build.
6. **Edge checker scope:** the existing script now checks 12 entrypoints, including both Apollo handlers and find-decision-makers. This exposed pre-existing `knownPersonFlow.ts` row-ID type errors. The fix distinguishes stored rows with IDs from update patches; it changes no runtime logic.
7. **Free-source attribution is conservative:** staff blocks split across unrelated containers may fall back to a company line. The worker does not return staff-page HTML, so its source URL alone never proves a direct dial. Browser width checks are still required.

## Tests and gates

Tests were added before the shared parsing/review/engine behavior, normalization/Undo fix, provenance-copy behavior and original-text persistence. Initial assertions failed against the missing behavior before implementation. The API endpoint tests run real handlers with in-memory database/provider boundaries and a network-forbidden fetch stub. Page-reader tests confirm provenance capture reuses exactly the existing home/team/about/contact fetches.

Coverage includes GB/IE/US/AE/SA normalization and type ambiguity; junk rejection; unchanged Phase 3 acceptance/rejection shapes; direct beside name, company fallback, nothing found and dismissed suggestions; no contact auto-write; ambiguous/stale/dismissed contacts; session RLS refusals and blank-phone compare-and-set; normalized Undo suppression; provenance/original retention; own-key-only reveal; no spending without an explicit request/key/lead visibility; duplicate request/callback handling; manual-phone preservation; phone chips, filter behavior, sole-trader metadata and dialer E.164 output.

Final gates on the final code revision:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS, 0 diagnostics |
| Full `npx vitest run` with JSON reporter/output file | PASS, **150/150 files, 2,402/2,402 tests**, 0 failed, 0 pending |
| `npm run build` | PASS, 2,883 modules transformed, 0 errors; existing >500 kB chunk warning remains |
| `node scripts/places-edge-typecheck.mjs` | PASS, 12 entrypoints, 0 diagnostics |
| `git diff --check` | PASS |

All environment-dependent runs used only `VITE_SUPABASE_URL=http://127.0.0.1:54321` and `VITE_SUPABASE_ANON_KEY=local-test-placeholder`.
An initial environment-less full run reported 2,380 passing tests and one failure: `hunterLimits.test.ts` / “words the allowance for the confirm dialog”, because the required Vite variables were absent. The full suite was rerun with the prescribed dummy values and passed. No production-code fix was needed for that environment failure. The full suite/build/typechecks were repeated after the final original-text retention change, with the passing counts above.

Local JSON test evidence: `.superpowers/phone-check/vitest-final.json` (ignored scratch, not committed). Source import traversal produced the deployment list below; the edge check includes all those entrypoints and three existing baseline entrypoints.

## Not verified

- Deno runtime, deployment bundling and live npm resolution: not run; the edge check is a local TypeScript shim.
- Live Apollo plans, credits, balances, matching, async delivery and real numbers: not called or verified.
- Database migration, audit execution, real PostgREST/RLS/concurrency and trigger behavior: not run or applied. The SQL audit tests editor, view-only, cross-organisation and anon access, constraints, original retention and existing provider-column restrictions, then deliberately raises to roll back its fixtures.
- Browser rendering, phone-width overflow, both themes, keyboard/focus and full authenticated flows: not verified. Browser inventory was empty and opening the in-app browser returned `Browser is not available: iab`. Real component server-render tests check markup/link/key-gating behavior but cannot establish layout or interactive browser accessibility.
- No independent architect review or production verification.

## Edge functions requiring a later deployment

This exact list follows the changed shared import graph, not just the two directly edited handler folders:

1. `apollo-phone-webhook`
2. `enrich-leads-bulk`
3. `find-decision-makers`
4. `org-api-settings`
5. `reveal-decision-maker`
6. `run-deep-find`
7. `run-lookup-jobs`
8. `run-selected-autopilot`
9. `scrape-companies-house`

Nothing was deployed. A later rollout needs Claude review, resolution of the allowance limitation, Kevin's explicit approval, migration 068 and its rollback audit before the new frontend/edge code uses these columns, followed by authorized deployment and live/browser checks. Existing webhook JWT/HMAC configuration remains unchanged. No VPS change is needed.

## Local commits

- `48933065952238abaad5a3452bf724c677c40dd4` — draft migration and rollback audit.
- `27befc9d6cab340903fca5741d1f631e2224dfcd` — shared phone model and reviewed Deep find suggestions.
- `cbc63da170f5e7282d7239fba75e1412800c9d4c` — explicit own-key Apollo requests and callback handling.
- `505550bda48c1a641384dfded4e13c99f6a0bedd` — phone UI, filters, dialer and sole-trader flags.
- `1774e5bc26477a794aedc07b1bac41c44efb9416` — original text retained alongside normalized contact numbers.

Every commit used explicit staged paths, `git -c core.hooksPath=NUL commit`, and the requested Codex co-author trailer.

## Files changed

Code/configuration/tests/SQL (48 files):

```text
package-lock.json
package.json
scripts/places-edge-typecheck.mjs
src/components/deepfind/SuggestionRows.tsx
src/components/pipeline/AdditionalDetails.tsx
src/components/pipeline/ContactRevealButtons.tsx
src/components/pipeline/ContactRow.tsx
src/components/pipeline/DecisionMakerReview.tsx
src/components/pipeline/DecisionMakersCard.tsx
src/components/pipeline/FilterBar.tsx
src/components/pipeline/LeadCard.tsx
src/components/pipeline/LeadPanelSections.tsx
src/components/pipeline/PhoneBusinessNotice.tsx
src/components/pipeline/PhoneChip.tsx
src/hooks/useLeads.ts
src/lib/apolloPhone.test.ts
src/lib/decisionMakerAdditions.test.ts
src/lib/decisionMakerAdditions.ts
src/lib/deepFindPhase3Engine.test.js
src/lib/deepFindReview.test.ts
src/lib/deepFindReview.ts
src/lib/deepFindView.ts
src/lib/dialerFilters.ts
src/lib/knownPersonLookup.test.ts
src/lib/leadFilters.ts
src/lib/personPhoneReview.test.ts
src/lib/phoneBusiness.ts
src/lib/phoneEndpoints.test.js
src/lib/phoneNumbers.test.ts
src/lib/phonePresentation.test.ts
src/pages/PowerDialer.tsx
src/types/index.ts
supabase/audits/068_phone_metadata.sql
supabase/functions/_shared/apolloPeopleSearch.ts
supabase/functions/_shared/apolloPhone.ts
supabase/functions/_shared/deepFind.ts
supabase/functions/_shared/deepFindApply.ts
supabase/functions/_shared/deepFindSuggestions.ts
supabase/functions/_shared/domainDiscovery.ts
supabase/functions/_shared/domainDiscoveryLookup.ts
supabase/functions/_shared/knownPersonFlow.ts
supabase/functions/_shared/knownPersonLookup.ts
supabase/functions/_shared/phoneNumbers.ts
supabase/functions/apollo-phone-webhook/index.ts
supabase/functions/reveal-decision-maker/index.ts
supabase/migrations/068_phone_metadata.sql
tsconfig.json
vite.config.ts
```

Task-local documentation (6 files): `AGENTS.md`, `CLAUDE.md`, `docs/AUTOMATIONS.md`, `docs/HANDOFF.md`, `docs/NEXT-STEPS.md`, and this report. No MD-import implementation files or other worktrees were touched.

## Stop / resume

Builder stops here. Open this worktree and this report for Claude's review against baseline `4d8cd00`. Resolve the numeric Apollo allowance requirement and verify the pending runtime/database/browser items before considering the feature fully accepted. No publication or remote action is authorized by this build.
