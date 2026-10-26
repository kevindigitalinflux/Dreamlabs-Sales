# Build brief: phone numbers for leads and decision makers

You are Codex, the builder. Claude is the architect and reviewer. Kevin directs.

Work only in this worktree (`C:/Users/kevin/Projects/dreamlabs-sales-phone`, branch `codex/phone-numbers`). Do not touch any other checkout. Another Codex agent is building a different feature (MD import) in a separate worktree; do not touch its files unless this spec requires it, and tell the report if you did.

## Read first

1. `docs/superpowers/specs/2026-10-22-phone-numbers-design.md` (APPROVED; the decisions section at the top is binding).
2. `CLAUDE.md` and `AGENTS.md` for project conventions and safety rules.
3. Existing code the spec names: `supabase/functions/_shared/websiteContact.ts`, `supabase/functions/_shared/googlePlacesLookup.ts`, `supabase/functions/_shared/deepFind.ts` and its Phase 3 phone plausibility checks, `supabase/functions/reveal-decision-maker/`, `supabase/functions/apollo-phone-webhook/`, `src/components/pipeline/` (lead card, contacts, decision makers), `src/pages/PowerDialer.tsx`, migrations 030, 038 and 050.

## Task

Build everything in the spec's Design section and Tests and delivery section:

1. Shared phone module (parse to E.164 with a country default, mobile versus landline where the numbering plan allows, junk rejection, GB/IE/US now, AE/SA ready). `libphonenumber-js` is approved. Keep pure and unit-tested; if the Deno edge functions need it, follow the repo's convention for shared modules and record how you resolved the npm import in the report.
2. Migration `068_phone_metadata.sql`: contact columns `phone_kind`, `phone_source`, `phone_source_url`, `phone_found_at` and `leads.phone_meta JSONB` (keyed by E.164). Additive only, no RLS or grant weakening. Existing phones are kept as kind `unknown`, source `manual`. Write it and a rollback audit under `supabase/audits/`; do NOT apply anything.
3. Deep find: decision-maker phone suggestions from already-fetched pages (no extra fetch), labelled "Company line" fallback as Add / Dismiss only, review-before-apply rules unchanged, all four suggestion cases tested (direct beside name, company line fallback, nothing found, dismissed).
4. Apollo reveal: explicit button state ("Reveal phone (uses your Apollo credits)"), shown only with the organisation's own key, prominent when the free sources found nothing for that person, never automatic.
5. UI: phone chips with kind label and source tooltip, `tel:` links, Power Dialer uses E.164, pipeline filters "has phone" and "has direct line". Accessible and mobile-friendly.

## Constraints

- TDD: failing test first, then implementation.
- Business numbers only; never scrape personal-data aggregators or social networks for phones. Flag sole-trader numbers as the spec says.
- No automated calling, no verification by call or SMS, no new paid provider, no per-organisation switch.
- Never swallow errors with a bare `catch {}`; log with context.
- Plain, short, jargon-free user text. Components under about 150 lines where practical.
- Do not change existing RLS, grants, the guard trigger on provider-set columns, or Phase 3 plausibility behaviour except through the shared module, and prove with tests that the checks are not loosened.
- Do not call any external service. Do not push, merge, deploy, apply migrations, or write to any remote or to Supabase. No real credentials, emails or messages.
- Dummy env values only for local runs (`VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY=local-test-placeholder`). Dependencies are already installed; `npm install libphonenumber-js` is the only addition allowed.
- Stage explicit file paths only. Small commits with `git -c core.hooksPath=NUL commit`, each ending with `Co-Authored-By: Codex <noreply@openai.com>`.

## Gates

`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, and the edge typecheck script `node scripts/places-edge-typecheck.mjs` if the edge graph changed. Report exact counts.

## Deliver

Write `docs/PHONE-NUMBERS-BUILD-REPORT.md`: what was built, files changed, gate results, decisions where the spec was silent, what was not verified (Deno runtime, live Apollo, browser, the unapplied migration), and the exact list of edge functions that would need deploying. Then stop. Claude reviews before any merge.
