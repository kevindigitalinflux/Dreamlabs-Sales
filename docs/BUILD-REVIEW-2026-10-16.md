# Build review — 2026-10-16

Local stacked branches only. Codex builder; Claude architect/reviewer. Main remains d7294d9cf8c567cd140c5a095b5a140bca0ae530. No push/main merge, deployment, SQL execution or remote write. Kevin authorized only the two local merges between these stacked branches during review fixes. Commit hooks disabled to avoid the forbidden outside-project vault sync. All builds retain the existing bundle-size warning. Browser/live/Deno-runtime checks are pending; shim typechecks are not deno check.

## Part 1: popups

Review range: main..codex/popups. TypeScript PASS, 0 diagnostics; Vitest PASS 84 files / 1,366 tests; build PASS 2,751 modules.

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
- src/lib/jobs/desktopNotifications.test.ts
- src/lib/jobs/desktopNotifications.ts
- src/lib/jobs/popups.test.ts
- src/lib/jobs/popups.ts
- src/pages/Settings.tsx

Pending: Claude review and actual browser permission/background/click/phone/theme checks. No migration. No blocking architect question.

## Part 2: worker keys

Review range: codex/popups..codex/worker-keys. TypeScript PASS, 0 diagnostics; Vitest PASS 87 files / 1,398 tests; build PASS 2,753 modules. Expanded edge-code shim typecheck PASS.

Commits (oldest first):

- d6843e661f85e5b95b50e3c0eb8b526f2f762776 feat: resolve and configure organisation lookup workers
- 06afaa2af9e68b3b3e5394eb216af3addc5503fc fix: require organisation admin for worker management and record handoff

Files changed relative to the preceding branch:

- CLAUDE.md
- docs/AUTOMATIONS.md
- docs/HANDOFF.md
- docs/NEXT-STEPS.md
- src/components/settings/LookupWorkerCard.tsx
- src/hooks/useOrgApiSettings.ts
- src/lib/lookupJobs.test.js
- src/lib/orgApiSettings.test.js
- src/lib/workerClient.test.ts
- src/lib/workerConfig.test.ts
- src/lib/workerStatus.test.ts
- src/lib/workerStatus.ts
- src/pages/OrganizationSettings.tsx
- supabase/audits/lookup_worker_provider.sql
- supabase/functions/_shared/deepFind.ts
- supabase/functions/_shared/lookupJobs.ts
- supabase/functions/_shared/orgApiKeys.ts
- supabase/functions/_shared/workerClient.ts
- supabase/functions/_shared/workerConfig.ts
- supabase/functions/org-api-settings/index.ts
- supabase/migrations/062_lookup_worker_provider.sql

Pending: Claude review, migration 062 and rollback audit (not executed), actual Settings/worker validation. Answered ruling: worker/Firecrawl management requires ADMIN membership of that org; platform admins without it stay excluded. Inherited static DNS-rebinding limitation remains; own workers still consume the shared pool by design. Keep the paid-key fallback flags unchanged. Before rollout, set WORKER_SHARED_ORG_IDS to include UX Tree and Digital Influx Academy; required UUIDs are in HANDOFF. Both engines and Settings use this worker-only allow-list.

## Part 3: Firecrawl

Review range: codex/worker-keys..codex/firecrawl. TypeScript PASS, 0 diagnostics; Vitest PASS 92 files / 1,463 tests; build PASS 2,753 modules. Expanded edge-code shim typecheck PASS.

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
- src/lib/organizationSettings.test.ts
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

Pending: Claude review, migration 063 and rollback audit (not executed), actual provider/Settings/EdgeRuntime checks. Both rulings ANSWERED: organisation-admin membership is mandatory; platform-only admins excluded. Kevin accepts the existing non-atomic checkRateLimit daily cap; it is not a strict billing bound under concurrency. Page count is submitted requests, not exact provider credits. Full decisions/security notes are in HANDOFF Part 3.

Next: Claude rereviews the three updated ranges in order against the supplied findings; no architect question remains. Kevin then separately authorizes SQL application (062 then 063), audits, and deployment. Nothing has been published.

## Review-fix round (2026-10-16)

Kevin supplied the independent findings and confirmed Codex BUILDER. The fixes themselves await independent rereview. All findings in the requested scope are implemented; no outstanding architect question.

| Branch | New commits this round | Gates |
|---|---|---|
| codex/popups | 94b72cc (M7/M8 fix) | tsc 0 diagnostics; 84 files / 1,366 tests; build 2,751 modules |
| codex/worker-keys | 27db2e3 (merge popups), 58d683f (I1/I2/M6/M9/M11) | tsc 0 diagnostics; 87 files / 1,398 tests; build 2,753 modules |
| codex/firecrawl | 0520ce5 (required merge of worker-keys FIRST), final fix commit containing this record (M1/M2/M3/M5/M9/M11/M12; use git rev-parse codex/firecrawl) | tsc 0 diagnostics; 92 files / 1,463 tests; build 2,753 modules |

Firecrawl client errors log fixed text only. Owner proposals require the requested roles and never feed the Hunter owner-email step; other people remain visible in step text. Optional checkpoint failures preserve earlier results. Org admins can remove Firecrawl keys. Missing-key notices are eligibility-based; zero-page counters omitted. Additional expanded local edge shim check passed for the final branch; browser/provider/Deno runtime checks pending.

WORKER_SHARED_ORG_IDS is NOT configured by this work. Kevin must include UX Tree and Digital Influx Academy before deploying (UUIDs in HANDOFF); their paid-key fallback flags remain false. Migrations 062/063 and rollback audits were not run. No push/main merge/deploy/live action. Both requested local stack merges are committed.

## Fix round 2 (latest, 2026-10-16)

| Branch | New commits | Final gates |
|---|---|---|
| codex/popups | 1988dc4: notify once per needs-you transition | tsc 0 diagnostics; 84 files / 1,368 tests / 0 failures; build 2,751 modules |
| codex/worker-keys | 52abca1: merge codex/popups | tsc 0 diagnostics; 87 files / 1,400 tests / 0 failures; build 2,753 modules |
| codex/firecrawl | 4f2c0fd: merge codex/worker-keys FIRST; fix commit containing this record (git rev-parse codex/firecrawl) | tsc 0 diagnostics; 93 files / 1,484 tests / 0 failures; build 2,753 modules |

M8 uses the previous job state to detect entry, with a new delivery-history episode key on re-entry; count changes stay silent. M3 uses import-free checkpoint classification: confirmed cancellation/access loss returns skipped immediately, keeps earlier contacts and starts no further paid/worker/contact writes; transient read failure skips only Firecrawl and logs fixed text. Enrich/lookup behavior unchanged. Tests failed before each fix. No new migration/audit/provider/remote action; independent rereview and browser/Deno/provider checks pending. All builds retain the existing size warning. Commit hooks were not run on Codex commits; the vault mirror is refreshed manually by Claude.

Fix-round manifests (in addition to the preceding round):
- Popups: src/lib/jobs/popups.ts, src/lib/jobs/popups.test.ts, CLAUDE.md, docs/HANDOFF.md, docs/NEXT-STEPS.md.
- Worker-keys: required merge, documentation conflict resolution and gate checkpoint only.
- Firecrawl: required merge, supabase/functions/_shared/deepFind.ts, new deepFindCheckpoint.ts, firecrawlClient.ts (comment only), src/lib/deepFindFirecrawl.test.js, new src/lib/deepFindCheckpoint.test.ts, docs/AUTOMATIONS.md, docs/HANDOFF.md, docs/NEXT-STEPS.md, CLAUDE.md and this record.
