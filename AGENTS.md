# AGENTS.md — Dreamlabs Sales (read this first, Codex)

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
3. **Live database:** do not run `apply_migration` or write SQL against the production project unless Kevin explicitly authorizes it (the Supabase tool permission classifier blocks `apply_migration`; Kevin normally applies migrations in the Supabase SQL editor). Write migrations in `supabase/migrations/` (next number after 060) plus a rolled-back audit script in `supabase/audits/`, reviewed by the other agent before Kevin applies them.
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
