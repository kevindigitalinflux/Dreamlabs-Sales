# AGENTS.md — Dreamlabs Sales (read this first, Codex)

## Readiness and Autopilot fixes checkpoint (2026-10-26, this worktree)

This checkout is `C:/Users/kevin/Projects/dreamlabs-sales-readiness`, branch `codex/readiness-and-fixes`. Kevin's `docs/READINESS-AND-FIXES-BUILD-BRIEF.md` supersedes historical task pointers below. Codex is builder; Claude remains architect/reviewer. Application revision `365a8d121b13fd1aacfa929b334bb854e959d6d7` builds readiness part 3d and TODO C8–11 locally. All local gates pass: 163 files / 2,501 tests, TypeScript, production build, 14-entrypoint edge shim and whitespace. Read `docs/READINESS-AND-FIXES-BUILD-REPORT.md` and the current task section in `docs/HANDOFF.md`. Migration 065 and its two separately marked audit blocks are written only. Existing table-wide lead UPDATE privileges also cover readiness; no grant, RLS or existing guard changed. Deno, database, browser, phone-width and live checks plus independent review remain pending. Part 3e is outside scope. No push, merge, deployment, SQL, external service, other-checkout write or vault sync is authorized. Builder stops after the report; do not resume unrelated historical work.

## Phone numbers checkpoint (2026-10-26, this worktree)

This checkout is `C:/Users/kevin/Projects/dreamlabs-sales-phone`, branch `codex/phone-numbers`. Kevin's phone build brief supersedes stale checkout/next-task notes below. Codex remains builder and Claude architect/reviewer. Read `docs/PHONE-NUMBERS-BUILD-REPORT.md` and the current `docs/HANDOFF.md` pointer. Tested code: `1774e5bc26477a794aedc07b1bac41c44efb9416`; local gates pass (150 files, 2,402 tests, TypeScript, build, 12-entrypoint edge shim, whitespace). Migration 068/audit are unapplied. Numeric Apollo allowance still needs an architect ruling; Deno/database/provider/browser checks and independent review remain pending. No push, merge, deploy, remote write, other-worktree edit or vault sync is authorized. All commits use explicit paths, disabled hooks and the Codex trailer. Builder has stopped for review; do not resume unrelated historical next steps.

**First read, in the Obsidian vault: `_Team/Shared agent workflow.md`, then `docs/HANDOFF.md` in this repo (the exact resume point).** Those supersede the older fixed-role split. Summary of the shared workflow (Kevin's decision, 2026-10-15): by default Claude is architect/reviewer and Codex is builder, but EITHER agent may plan, build, review, merge or deploy when Kevin confirms the role assignment or authorizes the action; every role change must be confirmed by Kevin and recorded (old role, new role, scope, reason, date) in `docs/HANDOFF.md` and the vault `Decisions.md`; ask Kevin a short kickoff at the start of each new task; paid API fallback always needs Kevin's approval; checkpoint near 90% of a usage limit. Kevin (non-engineer owner) holds all secrets. The project-specific safety rules below still apply to both agents. Obsidian is the shared second brain (see "Second brain").

## Where the project is
- **Local folder: `C:\Users\kevin\Projects\dreamlabs-sales`** (Windows 11; drag this folder into Codex).
- GitHub: `https://github.com/kevindigitalinflux/Dreamlabs-Sales` (branch `main` auto-deploys).
- Live site: `https://dreamlabs-sales.kevindigitalinflux.workers.dev` (also `https://sales.didreamlabs.com`). Cloudflare Workers deploys from `main`, about 2 to 3 minutes.
- Supabase project ref: `wgomksxelyfkzepbnkdd`.
- Lookup worker (VPS): `https://lookup.didreamlabs.com`, code in `worker/`.
- Full project memory: `CLAUDE.md` (long, newest entries at the end of "Current Status"), spec `SPEC.md`, to-do list `docs/NEXT-STEPS.md`, specs and plans in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

## What it is
Internal sales app for Digital Influx Dreamlabs and sales contractors: pipeline (leads, contacts), scraper, Deep find (finds people and emails), emails/sequences, Autopilot, power dialer, LinkedIn queue, analytics, a Jobs tracker (`/jobs`) and worker usage limits.

## Stack (real, newer than the table in CLAUDE.md)
Vite + React 19 + TypeScript strict + Tailwind v4 + React Router, Supabase (Postgres, RLS, Auth, Realtime, Edge Functions on Deno, pg_cron), Cloudflare Workers static assets for the front end, vitest for tests.

## Commands (run from the project folder)
- `npm install`, `npm run dev`
- `npx tsc --noEmit` (must be clean)
- `npx vitest run` (must be fully green; about 1,290 tests)
- `npm run build` (tsc + vite build)
Edge functions import with the `.ts` extension; shared edge code lives in `supabase/functions/_shared/`. Tests for it live in `src/lib/` and import `../../supabase/functions/_shared/<file>` without the extension. Files that import `npm:` packages (for example `deepFind.ts`) cannot be imported by tests, so keep logic in import-free modules (like `workerRules.ts`, `usageRules.ts`) and test those. `deno` is not installed locally.

## Working rules (binding)
1. **Work on a branch** (`codex/<short-task-name>` for Codex, `claude/<name>` for Claude). Merge or push to `main` only when Kevin has authorized it for this work; otherwise hand back the branch name and the test results. One active writer per task and checkout.
2. **Stage explicit files only** (`git add path/to/file`). Never `git add .` or `-A`: this Windows checkout has CRLF/LF noise that shows many modified files; do not commit it. Commit trailer: `Co-Authored-By: Codex <noreply@openai.com>`.
3. **Live database:** do not run `apply_migration` or write SQL against the production project unless Kevin explicitly authorizes it for THAT migration or script in chat. When he does (decision 2026-10-16: "as long as I give you permission you can do it"), the architect (Claude) may apply the migration with the Supabase `apply_migration` tool (Claude Code has it; Codex must not) and then run the rolled-back audit script through `execute_sql`, verify nothing persisted, and report the result; otherwise Kevin applies migrations in the Supabase SQL editor. Never apply anything that was not reviewed by the other agent, and never apply a migration in the same step as an unreviewed change. Write migrations in `supabase/migrations/` (next number after 064) plus a rolled-back audit script in `supabase/audits/` that ends in `RAISE EXCEPTION` inside a single `DO $$` block, reviewed by the other agent first.
4. **Deploys** (edge functions, the VPS worker) happen after review and only with Kevin's authorization for that work (either agent may deploy once authorized). Take a Hostinger snapshot before any VPS change.
5. **Secrets:** never print, paste, commit or log keys, tokens or secrets (`WORKER_SECRET`, `WRAPPER_SECRET`, `CRON_SECRET`, API keys, tunnel token). They live in the VPS `.env` (mode 600), Supabase function secrets, Supabase Vault and the gitignored `.env`. If something needs a secret, ask Kevin to run the command himself.
6. **Test first** for any logic you can test; keep everything green before handing back; report failures by name.
7. **Review-before-send:** nothing may email or message real people, or add anyone to a sequence, without a human reviewing it. Found or guessed email addresses are suggestions, never auto-added to sequences.
8. **Worker rules:** call the lookup worker only through `supabase/functions/_shared/workerClient.ts` (reserve usage BEFORE every request, refund at most once and only if the worker did no work, fail closed). New realtime watches may only name tables in the `supabase_realtime` publication (deep_find_runs, deep_find_leads, autopilot_run_leads, scrape_jobs, raw_leads).
9. **Do not touch** the VPS n8n (Hostinger KVM `srv1726663`, 2.24.131.162) or its data, and do not touch the JM Publicidad or other Cloudflare accounts.
10. Plain-English user-facing text; accessibility matters (labels, focus, contrast); phone width must work (no sideways scroll).
11. Update docs when you finish: a short entry in `CLAUDE.md`, a row in `docs/AUTOMATIONS.md` for any automation, and tick items in `docs/NEXT-STEPS.md`.

## What to do now
Open `docs/HANDOFF.md` (exact checkpoint) and `docs/NEXT-STEPS.md`. First: Kevin reruns Deep find on Love Living to confirm the scraper line. Then **Stage 2: "Fill in missing details" and "Find decision maker" as background jobs in the Jobs tracker**. It has NO approved spec or plan yet: run the short kickoff with Kevin, confirm who plans and who builds (record it), write `docs/superpowers/specs/2026-10-15-background-lookups-design.md`, get Kevin's approval, then plan and build.

## Second brain (Obsidian)
Vault: `C:/Users/kevin/OneDrive/Desktop/DI Dreamlabs Context Brain` (one vault, one folder per project; this project is `Dreamlabs Sales/`). Start at `00 Index.md` in the vault. Read the project's `Status.md` and `Decisions.md` before big changes; append a dated line to `Dreamlabs Sales/Log.md` in the vault when you finish a task (what changed, branch, tests, anything the Architect must review). The repo files (`CLAUDE.md`, `AGENTS.md`, `docs/`) stay the source of truth for code facts; the vault holds decisions, status and cross-project context.

### Keeping the vault in sync (automatic)
- `scripts/sync-vault.sh` copies `AGENTS.md`, `CLAUDE.md`, `SPEC.md`, `docs/*.md` and the specs/plans into the vault folder `Dreamlabs Sales/Repo/` (one way, repo -> vault). A git `post-commit` hook runs it after every commit in this checkout, so anything either agent commits shows up in Obsidian.
- If you work in a DIFFERENT clone or worktree, install the hook there: `printf '#!/usr/bin/env bash\nbash "$(git rev-parse --show-toplevel)/scripts/sync-vault.sh" >/dev/null 2>&1 || true\n' > .git/hooks/post-commit` (Git Bash), or run `bash scripts/sync-vault.sh` before handing back. Override the vault location with `VAULT="<path>"`.
- The agent-written notes `Status.md`, `Decisions.md`, `Log.md` live ONLY in the vault (`Dreamlabs Sales/`); edit them there. The `Repo/` folder is read-only reference: never edit it, edit the repo files instead.

## Token discipline (both agents; Kevin's request 2026-10-16: allowances are limited, Codex's is almost used)
- Tools installed (see vault `_Tools/Token savers.md`): RTK (shell-output compression hook, `rtk` binary) and Caveman (short-answer voice). Hooks only help once the session is restarted and, in Codex, trusted via `/hooks`; do not rely on them: follow the habits below regardless.
- Shell: prefer RTK wrappers or flags that shrink output: `rtk git status`, `rtk git diff`, `rtk read <file>`, `rtk grep <pat> <path>`, `rtk test npx vitest run`, `rtk err npm run build`, `rtk err npx tsc --noEmit`. Never dump whole test or build logs; only failures and counts.
- Read only what you need: line ranges, not whole large files; `git diff --stat` before a full diff; do not re-read a file you just edited; do not re-read docs already summarised in HANDOFF.md.
- Write like Caveman: short sentences, no preamble, no recap of the task, no praise, no restating the spec. Plan in a few bullets, then act.
- Put long detail in files (HANDOFF.md section, report file) and keep the final answer short: branch, HEAD hash, commits, gate counts, files changed, open questions, next action (under about 25 lines).
- Use one run per branch; avoid re-running the full suite after every tiny edit (run the targeted test file, then the full gates once at the end).
- Do not paste whole diffs, logs or file contents into the final answer.


## Places build checkpoint (2026-10-22)
This branch is codex/places-new in C:/Users/kevin/Projects/dreamlabs-sales-places, not the older default checkout above. Read docs/PLACES-NEW-BUILD-REPORT.md and the latest docs/HANDOFF.md section. Enterprise Places is built locally; migration 067 and its rollback audit are written only. All local gates pass (141 files, 2,216 tests). Claude review and runtime/database/browser/provider checks remain pending. Do not touch the platform-owners checkout, call Supabase, run SQL/audits, push, merge or deploy under this task's authorization. Stage explicit paths only; this task's requested trailer is Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>.
## Platform owners build checkpoint (2026-10-22)
Tasks 1–6 built locally on codex/platform-owners. Read docs/HANDOFF.md section "Platform owners — local build" for exact commits, gates and review questions. Migration 066 and audit are drafts, not executed. Claude review and Kevin-approved rollout remain pending; no remote writes, push, merge, deployment or vault sync authorized for this build.

## MD setup import build checkpoint (2026-10-26)
The active task is the local build in `C:/Users/kevin/Projects/dreamlabs-sales-md-import`, branch `codex/md-import-build`. Read `docs/MD-IMPORT-BUILD-REPORT.md` and the latest `docs/HANDOFF.md` section. Markdown setup import, its admin wizard and both template-copy actions are built. Application revision `6ed94a5` passes TypeScript, 152 files / 2,390 tests, build and diff checks. Claude's independent review and browser/live Supabase checks remain pending. No migration, dependency, remote operation, vault sync, push, merge or deployment occurred or is authorized by this build. This checkpoint supersedes older task pointers for this worktree only.
