# Build brief: Deep find accuracy round 1 (Companies House brand match, own sources before Hunter)

You are Codex, the builder. Claude is architect and reviewer. Kevin directs. Roles unchanged. Kevin starts Codex after its weekly allowance renews (2026-11-04). Keep reads targeted; commit in small steps; write the report early.

Worktree: `C:/Users/kevin/Projects/dreamlabs-sales-accuracy`, branch `codex/deepfind-registry-brand-match` (from `origin/main` `d779777`). Run `npm ci` if needed. Work only there.

## Why (live failure, Kevin, 2026-11-03)
Deep find (Medium, 20 leads) did not find the Companies House company for the lead **"Fold7 - Global Creative Advertising Agency London HQ"** and offered unrelated candidates. A Google search for that exact name returns `FOLD 7 LIMITED`, company 04001759, active, private limited, SIC 73110, registered office 16-18 Kirby Street, London EC1N 8TS, as the first result. Claude's reading of the code (verify, do not assume):
1. Google Places names often carry a marketing descriptor after a separator ("Brand - Global Creative Advertising Agency London HQ"). `registrySearchNames(name)` (`supabase/functions/_shared/nameVariants.ts`) and `scoreCompanyCandidates` / `pickCompany` (`registrySearch.ts`) use the WHOLE string. The Companies House name search for the whole string finds nothing useful, and `pickCompany` requires every lead-name word (`fold7 global creative advertising agency london hq`) to appear in the company name, so a true match can never qualify.
2. "Fold7" vs "FOLD 7": `sameCompanyName` (compact form) handles it only once the descriptor is gone.
3. A web-proof layer already exists (`registryWebProof.ts`, `registryEvidence.ts`, `deepFindRegistry.ts`). Find out how it is used and why it did not rescue this case.

## Part A: brand-name extraction and matching (tests first)
1. Pure, import-free function `brandNameCandidates(name)`: returns the lead name plus its likely brand names, most specific first. Rules: split on ` - `, ` – `, ` — `, ` | `, `:` and keep the first segment (if the first segment is a single generic word, also try the longest segment); strip trailing descriptor phrases (agency, london hq, head office, official site and similar) when they follow a separator or form a long tail; keep digit/word joins ("Fold7" also yields "Fold 7", and "Fold 7" yields "Fold7"). Never return a candidate shorter than 3 characters or a single generic word (reuse the existing generic/industry word lists; do not create a second list). Max 4 candidates.
2. Use the candidates in the Companies House searches (`registrySearchNames` or its caller, still bounded by `MAX_REGISTRY_SEARCHES`; spend the budget on brand candidates before descriptor variants) and in scoring and `pickCompany` (a company matches when ANY brand candidate matches by the existing rules). Keep the location rules exactly as they are: no auto-pick when the address disagrees with a known location, no auto-pick when two active companies match.
3. Regression tests: Fold7 fixture (FOLD 7 LIMITED active with a London address, plus two unrelated "Fold" companies) auto-picks FOLD 7 LIMITED when the lead's city or postcode agrees, and returns a choice (not a pick) when the lead has no location and a second active "Fold 7 ..." company exists. All existing Love Living tests stay green.
4. Apply the same descriptor stripping to domain discovery name inputs ONLY if it is a one-line reuse of the same function; otherwise list it as a follow-up.

## Part B: web proof fallback (small, reuse what exists)
When the Companies House name search gives no auto-pick, the existing web-proof step should try the brand candidate with the query form that worked in Kevin's check, "<brand> companies house", then VERIFY any company number it returns against the Companies House API before use. Never trust a number from web text alone: the verified name must agree with a brand candidate, status active, and location when known. If this already exists, find why it did not fire for Fold7 (budget, Medium effort gating, `left()` time check, missing key) and report the cause; fix only if small. No new paid calls; respect the AI cap and `spend.ai`.

## Part C: own sources before Hunter (engine order)
Kevin: Hunter is the cherry on top, never relied on; our own sources come first. In `supabase/functions/_shared/deepFind.ts`, `discoverLeadDomains(...)` (call near line 450) runs Hunter name and finder calls before our own site reads and web results are used. Reorder so that, for each lead, own checks run first (lead's own site and saved pages, the lookup worker site scrape, DNS mail-server checks on name-built domains, own email checker, Companies House, web search) and Hunter is called only for what is still missing afterwards. Do not change caps, the `spend.hunter` reservation, the per-lead share (`companyDomainHunterCap`), effort presets, corroboration or trust rules (a Hunter result still never confirms a domain beyond the existing rules), or the lookup worker. Add tests with a fake provider that records call order (own steps before any Hunter call; with Hunter exhausted or refused the lead still completes and says so in plain words). If a clean reorder needs more than about 100 changed lines, STOP that part, write the exact proposal in the report and leave the code unchanged.

## Constraints
- TDD. No RLS, grant, migration or schema change. No new dependency. No external calls in tests. No push, merge, deploy, Supabase writes or secrets.
- Stage explicit paths only. Small commits with `git -c core.hooksPath=NUL commit`, each ending `Co-Authored-By: Codex <noreply@openai.com>`. Add one short dated section at the END of `docs/HANDOFF.md` only.

## Gates
`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs`, with `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-test-placeholder`. Baseline first (expected 202 files / 2,793 tests, 1 skipped) and exact final counts.

## Deliver
`docs/DEEPFIND-REGISTRY-BRAND-MATCH-BUILD-REPORT.md`: Fold7 root cause confirmed (with the test that reproduces it), what changed, the brand-candidate rules with at least 6 realistic names and their extracted candidates, the Part B finding, the Part C result or proposal, gate counts, what is not verified (live Companies House, a real run), and the deploy list (`run-deep-find` plus any other function importing the changed shared files). Then stop. Claude reviews before any merge.
