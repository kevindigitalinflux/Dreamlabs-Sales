# Deep find budget, registry eligibility and search status

## Result

Local work on codex/deepfind-budget from fetched origin/main 3e0f2a310a95bb06480b4232d239c7814b0d8a25. Kevin directs; Claude architects/reviews; Codex builds. This report is updated per fix. Independent review and live improvement remain unverified. No push, merge, deployment, migration execution, VPS change, installation, paid fallback or real provider request is authorized.

## Acceptance evidence

1. MET (Fix 1): three engine fixtures prove both budgets reach discovery; three discovery fixtures prove webSearch receives 25,000 ms with 120 seconds left, 10,000 ms with 40 seconds left and is not started below 34 seconds. Web starts before the site read. Other discovery work retains budgetMs capped at 10,000 ms. The optional webBudgetMs defaults to the prior budget for existing callers.
2. Pending: saved-data non-UK registry inference and no registry proof credit.
3. Pending: search not_configured status, counting and quiet per-lead disabling.
4. Pending: fixed-only Gemini failure codes.

## What changed

Fix 1 adds webBudgetMs to DiscoveryInput and the discoverLeadDomains adapter. Both Deep find discovery call sites pass min(WEB_BUDGET_MS, max(0, left()-30,000)) independently of the unchanged 10,000 ms discovery budget. Only webTask consumes the new allowance and keeps the existing 4,000 ms admission threshold and 25,000 ms ceiling. Existing callers/tests remain compatible. The new 120-second fixture initially received 10,000 ms; engine fixtures initially lacked the new property, before production edits. No existing assertion changed.

Fix 1 gates: 274 app files / 3,546 passed / one existing opt-in skip; 8 wrapper files / 166 passed; root and wrapper TypeScript, production build, whitespace and 29-entrypoint edge typecheck PASS. Logs: .superpowers/deepfind-budget-fix1-*.log. The commit containing this initial report is Fix 1; exact hashes will be recorded in the final ledger. All seven gates precede each explicit-path implementation commit.

## Not verified

Real latency, production uplift, live provider/worker behavior, credit accounting, database/RLS/concurrency, Docker and browser/mobile/runtime checks. No production or provider request ran. The only external action was the requested git fetch. No secret was read or printed. The existing large-chunk build warning and opt-in skipped test remain.

## Deviations and open questions

The code's prior saved-company rule allows a profile fetch on a non-UK lead. Kevin's new no-Companies-House rule takes precedence; Fix 2 will update and list that conflicting assertion. Unknown leads will retain prior behavior. No unresolved behavior question so far. Subscription usage is unavailable; local evidence is saved per milestone.
