# Build review — 2026-10-16

Local stacked branches only. Codex builder; Claude architect/reviewer. Main remains d7294d9cf8c567cd140c5a095b5a140bca0ae530. No push, merge, deployment, SQL execution or remote write. Commit hooks disabled to avoid the forbidden outside-project vault sync. All builds retain the existing bundle-size warning. Browser/live/Deno-runtime checks are pending; shim typechecks are not deno check.

## Part 1: popups

Review range: main..codex/popups. TypeScript PASS, 0 diagnostics; Vitest PASS 83 files / 1,362 tests; build PASS 2,750 modules.

Commits (oldest first):

- 6f5da709de1c903779d32cc48fb69aec94bb5d0a feat: add opt-in desktop job notifications
- c999154dd8c89c5d44989a7080e75ca9203f7c6b docs: hand off Part 1 popups for review

Files changed relative to the preceding branch:

- CLAUDE.md
- docs/AUTOMATIONS.md
- docs/HANDOFF.md
- docs/NEXT-STEPS.md
- src/components/settings/DesktopNotificationsCard.tsx
- src/hooks/useDesktopNotifications.ts
- src/hooks/useJobs.tsx
- src/lib/jobs/popups.test.ts
- src/lib/jobs/popups.ts
- src/pages/Settings.tsx

Pending: Claude review and actual browser permission/background/click/phone/theme checks. No migration. No blocking architect question.

## Part 2: worker keys

Review range: codex/popups..codex/worker-keys. TypeScript PASS, 0 diagnostics; Vitest PASS 85 files / 1,386 tests; build PASS 2,751 modules. Expanded edge-code shim typecheck PASS.

Commits (oldest first):

- d6843e661f85e5b95b50e3c0eb8b526f2f762776 feat: resolve and configure organisation lookup workers
- 06afaa2af9e68b3b3e5394eb216af3addc5503fc fix: require organisation admin for worker management and record handoff

Files changed relative to the preceding branch:

- CLAUDE.md
- docs/HANDOFF.md
- docs/NEXT-STEPS.md
- src/components/settings/LookupWorkerCard.tsx
- src/hooks/useOrgApiSettings.ts
- src/lib/lookupJobs.test.js
- src/lib/orgApiSettings.test.js
- src/lib/workerConfig.test.ts
- src/pages/OrganizationSettings.tsx
- supabase/audits/lookup_worker_provider.sql
- supabase/functions/_shared/deepFind.ts
- supabase/functions/_shared/lookupJobs.ts
- supabase/functions/_shared/orgApiKeys.ts
- supabase/functions/_shared/workerConfig.ts
- supabase/functions/org-api-settings/index.ts
- supabase/migrations/062_lookup_worker_provider.sql

Pending: Claude review, migration 062 and rollback audit (not executed), actual Settings/worker validation. Platform-only management is withheld pending org-admin scope ruling. Inherited static DNS-rebinding limitation remains; own workers still consume the shared pool by design. Confirm intended org fallback flags at rollout; none were changed.

## Part 3: Firecrawl

Review range: codex/worker-keys..codex/firecrawl. TypeScript PASS, 0 diagnostics; Vitest PASS 89 files / 1,425 tests; build PASS 2,751 modules. Expanded edge-code shim typecheck PASS.

Commits (oldest first):

- 9eeeef94a5a5744b65260fdafa081fea89b86899 feat: add BYO Firecrawl team-page fallback for Deep find and lookups
- Final documentation commit: this manifest, HANDOFF, CLAUDE, AUTOMATIONS and NEXT-STEPS; obtain its full hash with git rev-parse codex/firecrawl (self-reference intentionally omitted).

Files changed relative to the preceding branch:

- CLAUDE.md
- docs/AUTOMATIONS.md
- docs/BUILD-REVIEW-2026-10-16.md
- docs/HANDOFF.md
- docs/NEXT-STEPS.md
- src/components/pipeline/EnrichmentReview.tsx
- src/hooks/useOrgApiSettings.ts
- src/lib/deepFindFirecrawl.test.js
- src/lib/enrichWorkerFallback.test.ts
- src/lib/firecrawlClient.test.ts
- src/lib/firecrawlRules.test.ts
- src/lib/lookupJobs.test.js
- src/lib/orgApiKeys.test.js
- src/lib/orgApiSettings.test.js
- src/pages/OrganizationSettings.tsx
- supabase/audits/firecrawl_provider.sql
- supabase/functions/_shared/deepFind.ts
- supabase/functions/_shared/deepFindProblems.ts
- supabase/functions/_shared/enrichLead.ts
- supabase/functions/_shared/firecrawlClient.ts
- supabase/functions/_shared/firecrawlRules.ts
- supabase/functions/_shared/lookupJobs.ts
- supabase/functions/_shared/orgApiKeys.ts
- supabase/functions/_shared/websiteContact.ts
- supabase/functions/org-api-settings/index.ts
- supabase/migrations/063_firecrawl_provider.sql

Pending: Claude review, migration 063 and rollback audit (not executed), actual provider/Settings/EdgeRuntime checks. Platform-only management is withheld. Existing requested checkRateLimit implementation is not atomic under concurrency; strict daily spend enforcement awaits an architect decision. Page count is submitted requests, not exact provider credits. Full decisions/security notes are in HANDOFF Part 3.

Next: Claude reviews the three ranges in order and rules on the two withheld questions. Kevin then separately authorizes SQL application (062 then 063), audits, and deployment. Nothing has been published.
