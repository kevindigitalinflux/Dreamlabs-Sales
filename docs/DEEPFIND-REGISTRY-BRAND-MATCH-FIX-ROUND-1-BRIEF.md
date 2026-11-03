# Fix round 1: derived brand names must match exactly (Claude review of aa84b51)

You are Codex, the builder. Claude is architect and reviewer. Kevin directs. Same worktree and branch as the build: `C:/Users/kevin/Projects/dreamlabs-sales-accuracy`, `codex/deepfind-registry-brand-match`. Keep reads targeted; commit in small steps; stop after the report addendum.

## Finding (confirmed by Claude with a scratch test, not committed)
Gates re-run by Claude: tsc clean, 205 files / 2,803 tests (1 skipped), `git diff --check` flags only blank lines at EOF in `docs/DEEPFIND-REGISTRY-BRAND-MATCH-BUILD-REPORT.md` and `supabase/functions/_shared/companyNameWords.ts` (remove them). Fold7 now picks FOLD 7 LIMITED correctly.

But the brand change loosened matching too far. `pickCompany`, `scoreCompanyCandidates` and `registryEvidence.matchRegistryEvidence` accept a company when ALL words of ANY brand candidate appear in the company name (subset rule). A derived first segment is often only part of the real name, so:
- lead `Smith - Plumbing Services London HQ`, one active `SMITH ROOFING LIMITED` in the same city -> `auto_location` (WRONG company chosen)
- lead `Bright - Fox Cleaning`, one active `BRIGHT SPARK LIMITED` in the same city -> `auto_location` (WRONG)
The legacy path in `registryEvidence.ts` (~line 80, `pickCompany(...).chosen` plus `E2`) then keeps it. A wrong company attached to a lead means wrong officers and wrong people looked up.

## Required change
1. The ORIGINAL full lead name keeps the existing subset rule exactly as before this build (no behaviour change for names without a descriptor).
2. Any DERIVED brand candidate (everything `brandNameCandidates` returns except the original name) matches a company only when the company's name tokens (legal forms removed, via the existing `companyNameTokens`) are EXACTLY the same set as the brand's tokens, or `sameCompanyName(company, brand)` is true (this keeps `Fold7` = `FOLD 7 LIMITED`). Apply the same exactness in `scoreCompanyCandidates` (the `all` bonus), `pickCompany` (`matches` and `isExact`) and `matchRegistryEvidence` (`allWords`).
3. Partial matches still appear in the candidate list for the user to choose (so `SMITH ROOFING LIMITED` can be offered), they just never auto-pick.
4. Tests first (they must fail on aa84b51): the two cases above return `chosen: null` (reason `ambiguous`) through BOTH `pickCompany` and the full `matchRegistryEvidence` path with outward-code and postcode agreement; Fold7 still auto-picks FOLD 7 LIMITED; `Acme - Official Site` picks `ACME LIMITED` but not `ACME ROOFING LIMITED`; Love Living tests unchanged. Also keep the digit join cases (`Fold 7` and `Fold7`).

## Constraints
Same as the build brief: no schema, RLS, grant, migration or new dependency; no push, merge, deploy or secrets; stage explicit paths; commits with `git -c core.hooksPath=NUL commit` ending `Co-Authored-By: Codex <noreply@openai.com>`. Do not touch Part B gating (Medium) or Part C; Claude and Kevin are deciding those.

## Gates and deliver
`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs` with the dummy env. Append a short "Fix round 1" section to the END of `docs/DEEPFIND-REGISTRY-BRAND-MATCH-BUILD-REPORT.md` with the failing-then-passing tests, exact gate counts and anything not verified. Then stop.
