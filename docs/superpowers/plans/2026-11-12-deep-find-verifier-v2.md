# Deep find verifier v2 (stages 0 and 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the email verifier prove or refuse every address by fixing the verdict and skip faults, adding a free Microsoft mailbox check, and checking every remaining address format in a paced background pass after each Deep find lead.

**Architecture:** The VPS wrapper gains honest verdict reasons and one new route (`/ms-exists`). The edge side keeps the existing first pass unchanged in shape, fixes the hosted-mail skip rule, and adds a durable check queue (`deep_find_check_queue`) drained by a new cron function for up to 60 minutes per run. Tier rules gain Microsoft evidence and stop trusting unchecked saved addresses.

**Tech Stack:** TypeScript strict, Supabase edge functions (Deno), Postgres with RLS and `pg_cron`, Hono wrapper on the VPS (Node), Vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-12-deep-find-power-design.md` (sections 2, 4, 6 stage 0 and stage 1, 7).

**Deviations from the spec (Claude's calls, flagged to Kevin):**
- Spec stage 1 item 1 (a confirmed shared inbox counts as safe to send) is built as designed. Kevin confirmed this on 2026-11-12, replacing his 2026-11-11 ruling for one case only: a role address the mail server accepts on a domain that is NOT catch-all becomes T1 (Task 6). Every other role address stays under review as before.
- Spec item 2 (domain probe) needs no new route: the checker's own catch-all answer is the probe (Task 4).
- Spec item 6 (check before send) already exists at the send boundary. The hole closed here is the saved address trusted without proof (Task 6) and placeholder addresses (Task 5).

## Global Constraints

- Builder: Codex. Branch `codex/verifier-v2` from `origin/main`. One writer; do not touch other worktrees.
- NOT allowed: push, merge, deploy, applying a migration, any live SQL, any call to the VPS, the live worker, Microsoft, Gemini, Hunter or any external service, reading `.env` or secrets, vault sync. Commit with `git -c core.hooksPath=NUL commit`.
- Stop and write a question in the build report instead of guessing whenever a rule here conflicts with the code.
- Pure rules live in import-free modules under `supabase/functions/_shared/` and are tested from `src/lib/*.test.ts`. Nothing new may import `deepFind.ts` in a test.
- Worker calls go only through `workerClient.ts`: reserve usage before the request, refund at most once and only when the worker did no work, fail closed, a client timeout is not refunded.
- No address is ever enrolled or sent by this work. Auto-fill stays blank-only. Classification grants no permission to send.
- Role addresses (`isRoleAddress`): Kevin's 2026-11-12 decision replaces his 2026-11-11 ruling in exactly one case. A role address becomes T1 only when the checker answered `risky` / `role_account` for that exact address (deliverable, domain not catch-all). Publication alone, a catch-all acceptance, a timeout or Microsoft evidence never lifts a role address; those stay T3 `role_review` as today. Update the comment in `recipientTier.ts` that cites the 2026-11-11 ruling to say this.
- RLS on every new table; no client INSERT, UPDATE or DELETE on the queue; service-role RPCs are `SECURITY DEFINER` with `SET search_path = public` and `REVOKE ... FROM PUBLIC, anon, authenticated`.
- New realtime watches are not added. Components stay under 150 lines. No bare `catch {}` around multi-step async work.
- Exact values: per-domain pacing 4 starts per 60 s (unchanged); queue per-lead cap 30 checks; queue retry delays 90 s, 300 s, 900 s (3 retries, then give up); run window 60 minutes from `deep_find_runs.started_at`; Microsoft checks 20 per minute worker-wide; daily caps `worker_verify` 1,500 per org and 3,000 worker-wide.
- Gates before every commit that changes code: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs`; in `worker/wrapper`: `npx tsc --noEmit` and `npx vitest run`. Gate env: `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-test-placeholder`.
- Finish by writing `docs/VERIFIER-V2-BUILD-REPORT.md` (commits, gate counts, deviations, questions, what was not run) and a checkpoint block at the top of `docs/HANDOFF.md`. Then stop.

## Review Focus

1. A mail server that times out on every attempt: the lead must finish with those addresses "not confirmed" after 3 retries, never loop and never be emailed.
2. Two leads in one run sharing a mail domain: their queued checks must share the 4-per-60-s pacing and must not double-check the same address.
3. A person whose saved address is proven fake while a guessed format is proven real: the real one is offered as the replacement; the fake is never auto-deleted.
4. Microsoft reports "does not exist" for a real shared inbox (`info@`): the role address must not become "never" or be removed.
5. The run is stopped, the lead is deleted, or the creator leaves the organisation while checks are queued: queued rows end as skipped and nothing is written to the lead.

---

## File Structure

| File | Responsibility |
|---|---|
| `worker/wrapper/src/verifyEmail.ts` (modify) | Honest verdict reasons: role-deliverable and timeout |
| `worker/wrapper/src/msExists.ts` (create) | Microsoft mailbox-exists call and mapping |
| `worker/wrapper/src/app.ts` (modify) | Route `POST /ms-exists` |
| `supabase/functions/_shared/workerRules.ts` (modify) | New reasons, `parseMsExistsReply`, caps |
| `supabase/functions/_shared/workerClient.ts` (modify) | `msExists()` |
| `supabase/functions/_shared/runVerifyGate.ts` (modify) | Hosted-mail rule v2 |
| `supabase/functions/_shared/emailPrecheckRules.ts` (modify) | `isPlaceholderAddress` |
| `supabase/functions/_shared/scrapeChoice.ts` (create) | Which site the scraper reads |
| `supabase/functions/_shared/recipientTier.ts` (modify) | Microsoft evidence; saved address needs proof |
| `supabase/functions/_shared/verifyQueueRules.ts` (create) | Pure queue rules |
| `supabase/functions/_shared/verifyQueue.ts` (create) | Enqueue and drain with injected clients |
| `supabase/functions/run-verify-queue/index.ts` (create) | Cron entry point |
| `supabase/migrations/075_deep_find_check_queue.sql` (create) | Table, RLS, RPCs, cron |
| `supabase/audits/deep_find_check_queue.sql` (create) | Rolled-back audit |
| `scripts/deepfind-score.sql` (create) | Read-only pass-mark scoring |
| `src/components/deepfind/QueuedChecksLine.tsx` (create) | "N more addresses are being checked" |

---

### Task 1: Worker verdicts say what the mail server said

**Files:**
- Modify: `worker/wrapper/src/verifyEmail.ts`
- Test: `worker/wrapper/src/verifyEmail.test.ts`

**Interfaces:**
- Produces: `VerifyResult['reason']` gains `'timeout'`. A deliverable role address on a non-catch-all domain returns `{status:'risky', reason:'role_account'}` whatever `is_reachable` says.

- [ ] **Step 1: Write the failing tests**

```ts
it('reports a deliverable role address on a non-catch-all domain as risky role_account', () => {
  const reply = { is_reachable: 'risky', syntax: { is_valid_syntax: true }, mx: { accepts_mail: true },
    smtp: { can_connect_smtp: true, is_catch_all: false, is_deliverable: true, is_disabled: false, has_full_inbox: false },
    misc: { is_role_account: true, is_disposable: false } }
  expect(mapReacher('hello@a.co.uk', reply)).toEqual({ email: 'hello@a.co.uk', status: 'risky', reason: 'role_account' })
})
it('reports an SMTP timeout as unverifiable timeout', () => {
  const reply = { is_reachable: 'unknown', syntax: { is_valid_syntax: true }, mx: { accepts_mail: true },
    smtp: { error: { type: 'Timeout', message: { secs: 30, nanos: 0 } } } }
  expect(mapReacher('a@b.com', reply)).toEqual({ email: 'a@b.com', status: 'unverifiable', reason: 'timeout' })
})
it('still reports a catch-all role address as unverifiable catch_all', () => {
  const reply = { is_reachable: 'risky', syntax: { is_valid_syntax: true }, mx: { accepts_mail: true },
    smtp: { can_connect_smtp: true, is_catch_all: true, is_deliverable: true }, misc: { is_role_account: true } }
  expect(mapReacher('info@b.com', reply).reason).toBe('catch_all')
})
```

- [ ] **Step 2: Run** `cd worker/wrapper && npx vitest run src/verifyEmail.test.ts`. Expected: the first two FAIL (`unknown`).
- [ ] **Step 3: Implement in `mapReacher`**: add `error?: { type?: string }` to the `smtp` type; after the `has_full_inbox` line, return `risky/role_account` when `smtp.is_deliverable === true && misc.is_role_account === true`; before the final `unknown`, return `unverifiable/timeout` when `smtp.error?.type === 'Timeout'`. Keep every existing rule and its order otherwise.
- [ ] **Step 4: Run** the same command. Expected: PASS, and every existing test in the file still passes.
- [ ] **Step 5: Commit** `fix: worker reports deliverable role addresses and SMTP timeouts honestly`.

### Task 2: Worker route `/ms-exists`

**Files:**
- Create: `worker/wrapper/src/msExists.ts`, `worker/wrapper/src/msExists.test.ts`
- Modify: `worker/wrapper/src/app.ts`, `worker/wrapper/src/app.test.ts`

**Interfaces:**
- Produces: `export type MsExists = 'exists' | 'not_found' | 'unknown'`; `export function mapMsReply(raw: unknown): MsExists`; `export async function msExists(email: string, deps?: { fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<{ email: string; result: MsExists }>`. Route `POST /ms-exists {email}` returns that object, `400 {error:'bad_email'}` for an address `normaliseEmail` rejects, `429 {error:'rate_limited'}` over 20 per minute.

- [ ] **Step 1: Write the failing tests**

```ts
it.each([[0, 'exists'], [5, 'exists'], [6, 'exists'], [1, 'not_found'], [2, 'unknown'], [4, 'unknown']])('maps IfExistsResult %i', (code, want) => {
  expect(mapMsReply({ IfExistsResult: code, ThrottleStatus: 0 })).toBe(want)
})
it('is unknown when throttled, malformed or missing', () => {
  expect(mapMsReply({ IfExistsResult: 0, ThrottleStatus: 1 })).toBe('unknown')
  expect(mapMsReply(null)).toBe('unknown')
  expect(mapMsReply({ IfExistsResult: '0' })).toBe('unknown')
})
it('posts only the address to the Microsoft sign-in endpoint and never follows redirects', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  const fetchImpl = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ IfExistsResult: 1, ThrottleStatus: 0 })) }) as typeof fetch
  expect(await msExists('A@B.com', { fetchImpl })).toEqual({ email: 'a@b.com', result: 'not_found' })
  expect(seen!.url).toBe('https://login.microsoftonline.com/common/GetCredentialType')
  expect(JSON.parse(String(seen!.init.body))).toEqual({ username: 'a@b.com', isOtherIdpSupported: true })
  expect(seen!.init.redirect).toBe('error')
})
it('is unknown on a network error, a non-200 reply or a timeout', async () => {
  const boom = (async () => { throw new Error('x') }) as typeof fetch
  expect((await msExists('a@b.com', { fetchImpl: boom })).result).toBe('unknown')
  const bad = (async () => new Response('no', { status: 503 })) as typeof fetch
  expect((await msExists('a@b.com', { fetchImpl: bad })).result).toBe('unknown')
})
```

App tests: `/ms-exists` needs the secret header like every route; a bad address is 400; the 21st call inside one minute is 429.

- [ ] **Step 2: Run** `npx vitest run src/msExists.test.ts src/app.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `msExists.ts` (timeout default 10,000 ms, `AbortController`, never logs the address or the reply) and the route in `app.ts` with its own `RateLimiter(deps.msPerMinute ?? 20, 60_000)`, following the `/verify-email` route's shape. Add `msPerMinute?: number` and `msExistsImpl?` to `AppDeps`.
- [ ] **Step 4: Run** the same command plus `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: worker route for the Microsoft mailbox check`.

### Task 3: Edge worker rules and client for the new answers

**Files:**
- Modify: `supabase/functions/_shared/workerRules.ts`, `supabase/functions/_shared/workerClient.ts`, `supabase/functions/_shared/usageRules.ts`
- Test: `src/lib/workerRules.test.ts`, `src/lib/workerClient.test.ts`, `src/lib/usageRules.test.ts`

**Interfaces:**
- Produces: `REASONS` includes `'timeout'`; `export type MsExists = 'exists' | 'not_found' | 'unknown'`; `export function parseMsExistsReply(raw: unknown, expectedEmail: string): MsExists | null`; `WORKER_TIMEOUT_MS.msExists = 12_000`; `WorkerClient.msExists(email: string): Promise<WorkerResult<MsExists>>`; `USAGE_DEFAULTS.worker_verify = { orgLimit: 1500, globalLimit: 3000 }`.
- `msExists` uses resource `worker_verify`, 1 unit, path `/ms-exists`, and the same stop, refund and line rules as `verifyEmail` through the existing `call`. It does not count toward `MAX_VERIFY_PER_LEAD` and does not pass through `RunVerifyGate`.

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps the timeout reason from the worker', () => {
  expect(parseVerifyReply({ email: 'a@b.com', status: 'unverifiable', reason: 'timeout' }, 'a@b.com')).toEqual({ status: 'unverifiable', reason: 'timeout' })
})
it('parses a Microsoft reply only for the address asked about', () => {
  expect(parseMsExistsReply({ email: 'a@b.com', result: 'exists' }, 'A@b.com')).toBe('exists')
  expect(parseMsExistsReply({ email: 'x@b.com', result: 'exists' }, 'a@b.com')).toBeNull()
  expect(parseMsExistsReply({ email: 'a@b.com', result: 'maybe' }, 'a@b.com')).toBeNull()
})
```

Client tests (existing fake-fetch style): `msExists` reserves 1 `worker_verify` unit before the request; a 429 refunds it once; a wrong-address reply gives `bad_response` and no refund; with `config: null` it returns `not_configured` and makes no request. Usage test: `USAGE_DEFAULTS.worker_verify` equals `{ orgLimit: 1500, globalLimit: 3000 }`.

- [ ] **Step 2: Run** `npx vitest run src/lib/workerRules.test.ts src/lib/workerClient.test.ts src/lib/usageRules.test.ts`. Expected: new cases FAIL.
- [ ] **Step 3: Implement.** Widen `Kind` in `workerClient.ts` to include `'msExists'` mapped to resource `worker_verify`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: edge client for Microsoft checks and raised check caps`.

### Task 4: Hosted-mail skip rule v2

**Files:**
- Modify: `supabase/functions/_shared/runVerifyGate.ts:36-41`
- Test: `src/lib/runVerifyGate.test.ts` (existing file; add cases)

**Interfaces:**
- Consumes: Task 3's `timeout` reason.
- Produces: unchanged class surface. New behaviour on a hosted domain's first completed check:
  - `valid`, `invalid`, or `risky` with reason `role_account`: the domain is provable; later checks run.
  - `unverifiable` with reason `catch_all`: the domain is marked hosted-unverifiable (as today) with the notice `<domain>: this mail server accepts every address, so mailbox checks were skipped.`
  - a timeout, `unknown` or `checker_error`: the domain is NOT marked hosted-unverifiable. The existing `blocked` handling applies, and `canaryDone` stays false so the next check is again treated as the first.

- [ ] **Step 1: Write the failing tests** (use the file's existing in-memory store helper and `isHosted: async () => true`)

```ts
it('keeps checking a hosted domain after a deliverable role address', async () => {
  const first = await gate.run('hello@a.co.uk', 60_000, async () => ({ ok: true, value: { status: 'risky', reason: 'role_account' } }))
  const second = await gate.run('jo.bloggs@a.co.uk', 60_000, async () => ({ ok: true, value: { status: 'valid', reason: 'deliverable' } }))
  expect(first.ok && first.value.reason).toBe('role_account')
  expect(second.ok && second.value.status).toBe('valid')
  expect(gate.lines()).toEqual([])
})
it('stops checking a hosted catch-all domain and says why', async () => {
  await gate.run('a@b.com', 60_000, async () => ({ ok: true, value: { status: 'unverifiable', reason: 'catch_all' } }))
  let called = false
  const next = await gate.run('c@b.com', 60_000, async () => { called = true; return { ok: true, value: { status: 'valid', reason: 'deliverable' } } })
  expect(called).toBe(false)
  expect(next.ok && next.value.reason).toBe('hosted_unverifiable')
  expect(gate.lines()).toEqual(['b.com: this mail server accepts every address, so mailbox checks were skipped.'])
})
it('does not write off a hosted domain after one timeout', async () => {
  await gate.run('a@b.com', 60_000, async () => ({ ok: true, value: { status: 'unverifiable', reason: 'timeout' } }))
  expect(gate.lines().some(l => l.includes('accepts every address'))).toBe(false)
})
```

- [ ] **Step 2: Run** `npx vitest run src/lib/runVerifyGate.test.ts`. Expected: the three new cases FAIL; note which existing canary tests assert the old sentence.
- [ ] **Step 3: Implement** the rule above. Update existing tests that assert the old "could not confirm the canary address" sentence only where the new rule changes the outcome; list each changed assertion in the build report.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `fix: a role or slow answer no longer writes off a hosted mail domain`.

### Task 5: Placeholder addresses are refused

**Files:**
- Modify: `supabase/functions/_shared/emailPrecheckRules.ts`, `supabase/functions/_shared/emailPreSend.ts`
- Test: `src/lib/emailPrecheckRules.test.ts`, `src/lib/emailPreSend.test.ts`

**Interfaces:**
- Produces: `export function isPlaceholderAddress(address: string): boolean`. True when the domain is one of `example.com, example.org, example.net, domain.com, email.com, test.com, fakeemail.com, mailinator.com, sentry.io, wixpress.com` or a subdomain of one, or the local part is one of `test, example, noreply, no-reply, donotreply, do-not-reply, user, name, email, yourname, firstname.lastname`.
- `makeEmailPrechecker` returns `{status:'invalid', label:'This is a placeholder address, not a real mailbox', overridable:false}` for such an address, before any history, DNS or worker call.

- [ ] **Step 1: Write the failing tests**

```ts
it.each(['a@domain.com', 'x@fakeemail.com', 'abc@sentry-next.wixpress.com', 'noreply@acme.co.uk', 'firstname.lastname@acme.com'])('%s is a placeholder', a => expect(isPlaceholderAddress(a)).toBe(true))
it.each(['jo@acme.co.uk', 'info@acme.com', 'tester@acme.com'])('%s is not a placeholder', a => expect(isPlaceholderAddress(a)).toBe(false))
```

Pre-send test: a placeholder returns the label above and the injected worker, MX lookup and outcome lookup are never called.

- [ ] **Step 2: Run** `npx vitest run src/lib/emailPrecheckRules.test.ts src/lib/emailPreSend.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: refuse placeholder email addresses before any check`.

### Task 5b: The scraper reads every confirmed company site

**Files:**
- Create: `supabase/functions/_shared/scrapeChoice.ts`
- Modify: `supabase/functions/_shared/deepFind.ts:642-653` (the `hasContactDetails` / `scrapeDomain` selection only)
- Test: `src/lib/scrapeChoice.test.ts`

**Interfaces:**
- Produces: `export function chooseScrapeDomain(input: { verified: string[]; siteDomain: string | null; isDirectory(d: string): boolean; namedEmails(d: string): number }): string | null`. Returns the lead's own `siteDomain` when it is verified and not a directory; otherwise the first verified non-directory domain; otherwise `null`. A domain is skipped only when `namedEmails(d) >= 2` (two or more non-role addresses already read from its pages). Finding a phone number or one address no longer skips the scrape.
- `deepFind.ts` calls it in place of the current `find`. The existing `scrapeTimeoutFor(optionalBudget())` guard, the single scrape per lead, the usage rules and the suggestion wording stay as they are.

- [ ] **Step 1: Write the failing tests**

```ts
const base = { isDirectory: (d: string) => d === 'yell.com', namedEmails: () => 0 }
it('scrapes the lead site even when a phone or one address was already found', () => expect(chooseScrapeDomain({ ...base, verified: ['a.com'], siteDomain: 'a.com', namedEmails: () => 1 })).toBe('a.com'))
it('skips a site that already gave two named addresses', () => expect(chooseScrapeDomain({ ...base, verified: ['a.com'], siteDomain: 'a.com', namedEmails: () => 2 })).toBeNull())
it('never scrapes a directory or an unverified site', () => {
  expect(chooseScrapeDomain({ ...base, verified: ['yell.com'], siteDomain: 'yell.com' })).toBeNull()
  expect(chooseScrapeDomain({ ...base, verified: [], siteDomain: 'a.com' })).toBeNull()
})
it('prefers the lead site over another verified domain', () => expect(chooseScrapeDomain({ ...base, verified: ['b.com', 'a.com'], siteDomain: 'a.com' })).toBe('a.com'))
```

- [ ] **Step 2: Run** `npx vitest run src/lib/scrapeChoice.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement**; `namedEmails` in `deepFind.ts` counts `siteEmails.get(d)` entries for which `isRoleAddress` is false.
- [ ] **Step 4: Run** all gates. Expected: PASS.
- [ ] **Step 5: Commit** `feat: scraper reads every confirmed company site for published addresses`.

### Task 6: Tier rules use Microsoft evidence and stop trusting unchecked saved addresses

**Files:**
- Modify: `supabase/functions/_shared/recipientTier.ts`, `supabase/functions/_shared/recipientContext.ts`
- Test: `src/lib/recipientTier.test.ts`, `src/lib/recipientContext.test.ts`

**Interfaces:**
- `RecipientEvidence` gains `msExists?: 'exists' | 'not_found'` and `roleConfirmed?: boolean`. `TierBasis` gains `'ms_exists' | 'ms_not_found' | 'saved_unproven' | 'role_confirmed'`.
- The existing `roleNeedsReview` line becomes two: `roleNeedsReview && roleConfirmed` gives `T1 / role_confirmed / 'The mail server confirms this shared inbox.'`; `roleNeedsReview` otherwise gives T3 `role_review` exactly as today. Hard negatives, `replied` and `sentOk` still come first.
- `roleConfirmed` is true only when a check of that exact address returned status `risky` with reason `role_account`. Sources: the in-run checked map in `deepFind.ts` (the `prepareRecipientEvidence` call near line 1340), and in `recipientContext` the newest `deep_find_check_queue` row for the address with `kind = 'smtp'`, status `done`, reason `role_account`. Never set it from a catch-all, timeout, published or Microsoft result.
- `emailPreSend.ts`: a worker answer `risky` / `role_account` is treated like a `valid` answer (send allowed, cached the same way). Role addresses with any other answer keep today's review verdict.
- Rule order inside `recipientTier`, after the `roleNeedsReview` lines and before `checker==='valid'`:
  1. `msExists === 'exists'` gives `T1 / ms_exists / 'Microsoft confirms this mailbox exists.'`
- After the `placesEmail` line:
  2. `msExists === 'not_found'` gives `T3 / ms_not_found / 'Microsoft has no mailbox with this address. Review it.'`
  3. `savedNonGuessed && !generated` gives T1 `saved_non_guessed` only when `checker === 'valid'`; otherwise `T3 / saved_unproven / 'Saved address that no check has confirmed. Review it.'`
- The hard negatives, `replied`, `sentOk`, `roleNeedsReview`, `company_site` and `places` keep their current precedence and text. `msExists` never applies to a role address because `roleNeedsReview` returns first.
- `recipientContext` sets `msExists` from the newest `deep_find_check_queue` row for that address with `kind = 'ms_exists'` and status `done`, `exists` or `not_found` only. The table is defined in Task 7; use its column names exactly. A read error leaves `msExists` unset and never fails the caller.

- [ ] **Step 1: Write the failing tests**

```ts
const base = { forAddress: 'jo@a.com', syntaxValid: true, hasMailServer: true, generated: false, roleNeedsReview: false } as const
it('trusts a mailbox Microsoft confirms', () => expect(recipientTier('jo@a.com', { ...base, checker: 'unverifiable', msExists: 'exists' })).toMatchObject({ tier: 'T1', basis: 'ms_exists' }))
it('does not send to a saved address Microsoft cannot find', () => expect(recipientTier('jo@a.com', { ...base, savedNonGuessed: true, msExists: 'not_found' })).toMatchObject({ tier: 'T3', basis: 'ms_not_found' }))
it('keeps a published address T1 even when Microsoft cannot find it', () => expect(recipientTier('jo@a.com', { ...base, publishedByCompany: true, msExists: 'not_found' })).toMatchObject({ tier: 'T1', basis: 'company_site' }))
it('no longer trusts a saved address that no check confirmed', () => expect(recipientTier('jo@a.com', { ...base, savedNonGuessed: true, checker: 'unverifiable' })).toMatchObject({ tier: 'T3', basis: 'saved_unproven' }))
it('still trusts a saved address the checker confirmed', () => expect(recipientTier('jo@a.com', { ...base, savedNonGuessed: true, checker: 'valid' })).toMatchObject({ tier: 'T1' }))
it('never lets Microsoft evidence lift a role address', () => expect(recipientTier('info@a.com', { ...base, forAddress: 'info@a.com', roleNeedsReview: true, msExists: 'exists' })).toMatchObject({ tier: 'T3', basis: 'role_review' }))
it('trusts a shared inbox the mail server confirmed', () => expect(recipientTier('info@a.com', { ...base, forAddress: 'info@a.com', roleNeedsReview: true, roleConfirmed: true })).toMatchObject({ tier: 'T1', basis: 'role_confirmed' }))
it('keeps an unconfirmed shared inbox under review even when published', () => expect(recipientTier('info@a.com', { ...base, forAddress: 'info@a.com', roleNeedsReview: true, publishedByCompany: true })).toMatchObject({ tier: 'T3', basis: 'role_review' }))
it('a hard bounce beats a confirmed shared inbox', () => expect(recipientTier('info@a.com', { ...base, forAddress: 'info@a.com', roleNeedsReview: true, roleConfirmed: true, bouncedHard: true }).tier).toBe('never'))
it('does not condemn a shared inbox Microsoft cannot find', () => expect(recipientTier('info@a.com', { ...base, forAddress: 'info@a.com', roleNeedsReview: true, savedNonGuessed: true, msExists: 'not_found' })).toMatchObject({ tier: 'T3', basis: 'role_review' }))
it('a hard bounce still beats Microsoft', () => expect(recipientTier('jo@a.com', { ...base, bouncedHard: true, msExists: 'exists' }).tier).toBe('never'))
```

- [ ] **Step 2: Run** `npx vitest run src/lib/recipientTier.test.ts src/lib/recipientContext.test.ts`. Expected: FAIL. Existing tests that assert `saved_non_guessed` T1 without a checker verdict must be updated to the new rule; list each in the build report.
- [ ] **Step 3: Implement.** Any UI or analytics map keyed by `TierBasis` gets the four new keys with labels "Microsoft confirmed", "Microsoft has no such mailbox", "Saved, not confirmed", "Shared inbox confirmed". Add pre-send tests: a role address with worker answer `risky` / `role_account` is allowed; the same address with `unverifiable` / `catch_all` keeps today's review verdict.
- [ ] **Step 4: Run** the full `npx vitest run` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: tiers use Microsoft evidence and require proof for saved addresses`.

### Task 7: Check queue schema (written, not applied)

**Files:**
- Create: `supabase/migrations/075_deep_find_check_queue.sql`, `supabase/audits/deep_find_check_queue.sql`

**Interfaces:**
- Table `deep_find_check_queue`: `id uuid pk default gen_random_uuid()`, `org_id uuid not null references organizations on delete cascade`, `run_id uuid not null references deep_find_runs on delete cascade`, `lead_id uuid not null references leads on delete cascade`, `contact_id uuid null references decision_maker_candidates on delete set null`, `person_key text null`, `person_name text null check (char_length(person_name) <= 120)`, `address text not null check (address = lower(address) and char_length(address) <= 254)`, `domain text not null`, `kind text not null check (kind in ('smtp','ms_exists'))`, `rank smallint not null default 0`, `status text not null default 'queued' check (status in ('queued','running','done','skipped'))`, `verdict text null check (verdict in ('valid','invalid','unverifiable','exists','not_found'))`, `reason text null check (char_length(reason) <= 60)`, `provider text null check (provider in ('google','microsoft','hosted','unknown'))`, `attempts smallint not null default 0`, `next_at timestamptz not null default now()`, `claimed_at timestamptz null`, `finished_at timestamptz null`, `created_at timestamptz not null default now()`; unique `(run_id, address, kind)`; indexes `(status, next_at)` and `(lead_id)`.
- RLS on. One policy: SELECT for `authenticated` when `is_org_member(org_id) AND can_view_lead(lead_id)`. No client write grants.
- Service-role-only RPCs:
  - `deep_find_checks_enqueue(p_rows jsonb) returns integer`: inserts up to 200 rows, `on conflict do nothing`, refuses a lead that already has 30 rows in that run.
  - `deep_find_checks_claim(p_max integer) returns setof deep_find_check_queue`: claims up to `p_max` (max 10) rows with `status='queued' and next_at <= now()`, `for update skip locked`, at most 1 row per domain per call, never a domain with 4 or more rows `claimed_at > now() - interval '60 seconds'`, only when the run is `active` or finished less than 60 minutes after `started_at`; sets `running`, `claimed_at`, `attempts + 1`.
  - `deep_find_checks_finish(p_id uuid, p_status text, p_verdict text, p_reason text, p_provider text, p_next_at timestamptz) returns boolean`: updates only a `running` row; `queued` with `p_next_at` for a retry.
  - `deep_find_checks_expire() returns integer`: marks `queued` or stale `running` (claimed more than 5 minutes ago) rows `skipped` with reason `run_time_limit` when the run started more than 60 minutes ago or is cancelled, and `person_done` siblings as described in Task 8.
- Cron `run-verify-queue-tick` every minute calling the new function with the existing Vault `cron_secret`, copied from the `run-deep-find-tick` job's form.
- Audit (rolled back, fixture blocks marked local-only): member reads own org rows for a visible lead; no read for a hidden lead, another org or anon; no client insert, update or delete; RPC execute is service-role only; cascade on lead, run and org delete; claim respects one-per-domain, the 4-per-60-s rule and the 60-minute window; enqueue cap of 30 per lead per run; finish ignores a row that is not `running`.

- [ ] **Step 1: Write** the migration and audit. The migration starts with `RAISE EXCEPTION 'migration 075 is not approved yet'` inside a `DO` block as the first statement; Claude removes it after review.
- [ ] **Step 2: Verify** `git diff --check` is clean and the file names follow `074`.
- [ ] **Step 3: Commit** `feat: draft check queue schema and audit (not applied)`.

### Task 8: Pure queue rules

**Files:**
- Create: `supabase/functions/_shared/verifyQueueRules.ts`
- Test: `src/lib/verifyQueueRules.test.ts`

**Interfaces:**
- Produces:

```ts
export const QUEUE_MAX_PER_LEAD = 30;
export const QUEUE_RETRY_DELAYS_MS = [90_000, 300_000, 900_000] as const;
export const QUEUE_RUN_WINDOW_MS = 60 * 60_000;
export interface QueuePerson { personKey: string; name: string; contactId: string | null; first: string; last: string; priority: number }
export interface QueueCandidate { address: string; domain: string; kind: 'smtp' | 'ms_exists'; personKey: string | null; personName: string | null; contactId: string | null; rank: number }
export interface QueueInput {
  people: QueuePerson[];
  domains: { domain: string; provider: 'google' | 'microsoft' | 'hosted' | 'unknown'; state: 'provable' | 'catch_all' | 'no_answer' | 'unchecked' }[];
  alreadyChecked: Record<string, 'valid' | 'invalid' | 'unverifiable'>;
  savedAddresses: { address: string; contactId: string | null; personKey: string | null; personName: string | null }[];
  candidatesFor(person: QueuePerson, domain: string): string[];
}
export function planQueue(input: QueueInput): QueueCandidate[];
export type QueueOutcome = { status: 'done'; verdict: 'valid' | 'invalid' | 'unverifiable' | 'exists' | 'not_found'; reason: string } | { status: 'queued'; nextAt: number; reason: string } | { status: 'skipped'; reason: string };
export function nextStep(row: { kind: 'smtp' | 'ms_exists'; attempts: number }, answer: { ok: true; status: string; reason: string } | { ok: false; failure: string }, now: number): QueueOutcome;
export function siblingsToSkip(done: { personKey: string | null; verdict: string }, queued: { id: string; personKey: string | null; kind: string }[]): string[];
```

- Rules for `planQueue`:
  - Never plan an address in `alreadyChecked` as `valid` or `invalid`, a placeholder address, or a role address guess.
  - Every saved address not yet checked is planned first (rank 0), kind `smtp`; on a `microsoft` domain whose state is `catch_all` or `no_answer` it is planned as `ms_exists` instead. Exception: a saved role address is always `smtp` and never `ms_exists`, and is not planned at all on a `catch_all` domain.
  - For each person without a `valid` address, in `priority` order: on a `provable` or `unchecked` domain plan every `candidatesFor` format as `smtp`, rank = its position; on a `microsoft` domain that is `catch_all` or `no_answer` plan the first 4 formats as `ms_exists`; on any other `catch_all` domain plan nothing.
  - Deduplicate by address and kind. Cut at 30, keeping saved addresses, then rank order across people (round-robin by rank so every person gets their most likely format before anyone's second).
- Rules for `nextStep`: smtp `valid`/`invalid` and `risky role_account` are `done` (`role_account` maps to verdict `valid`, reason `role_account`; the drain records it as `checked_valid` and it is a saved address, so `applyProven` is not called for it); `catch_all` is `done unverifiable catch_all`; `timeout`, `unknown`, `checker_error`, worker failures `timeout`, `busy`, `unreachable` retry at `now + QUEUE_RETRY_DELAYS_MS[attempts - 1]` and become `done unverifiable <reason>` once `attempts > 3`; `limit_reached` and `not_configured` are `skipped` with that reason; ms `exists`/`not_found` are `done`, ms `unknown` retries on the same schedule.
- `siblingsToSkip`: when a person's row finishes `valid` or `exists`, return the ids of that person's other queued rows.

- [ ] **Step 1: Write the failing tests**, one per rule above, including: 3 people on a provable domain with 8 formats each plus 2 saved addresses yields exactly 30 rows with both saved addresses first and each person's rank-0 format before any rank-1; a Microsoft catch-all domain yields only `ms_exists` rows, 4 per person; a non-Microsoft catch-all yields none; `nextStep({kind:'smtp',attempts:1},{ok:true,status:'unverifiable',reason:'timeout'},1000)` equals `{status:'queued',nextAt:91_000,reason:'timeout'}`; attempts 4 gives `done unverifiable timeout`; `siblingsToSkip` returns only the same person's queued ids.
- [ ] **Step 2: Run** `npx vitest run src/lib/verifyQueueRules.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the module with no imports except types from `emailPrecheckRules.ts` (`isRoleAddress`, `isPlaceholderAddress`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: pure rules for the background check queue`.

### Task 9: Enqueue after each lead and drain in the background

**Files:**
- Create: `supabase/functions/_shared/verifyQueue.ts`, `supabase/functions/run-verify-queue/index.ts`, `src/lib/verifyQueue.test.js`
- Modify: `supabase/functions/_shared/deepFind.ts` (one call at the end of `processDeepFindLead`, after readiness is saved), `supabase/config.toml` (`[functions.run-verify-queue] verify_jwt = false`), `scripts/places-edge-typecheck.mjs` (add the entry point), `docs/AUTOMATIONS.md`

**Interfaces:**
- Consumes: Task 3 `WorkerClient.verifyEmail` and `msExists`; Task 7 RPCs; Task 8 rules; existing `recordEmailOutcome`, `makeRunVerifyGate`, `rankedEmailCandidates`, `cachedMailProvider`, `loadRecipientContext`, `evaluateReadiness`.
- Produces:

```ts
export async function enqueueLeadChecks(deps: QueueDeps, input: { orgId: string; runId: string; leadId: string; plan: QueueCandidate[] }): Promise<number>;
export async function drainQueue(deps: QueueDeps, startedAt: number, wallBudgetMs: number): Promise<{ processed: number }>;
export interface QueueDeps { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>; workerFor(orgId: string, runId: string): WorkerClient; recordOutcome(input: { orgId: string; leadId: string; address: string; outcome: string }): Promise<void>; applyProven(input: { orgId: string; leadId: string; contactId: string | null; address: string }): Promise<'applied' | 'suggested' | 'skipped'>; refreshReadiness(leadId: string): Promise<void>; canStillEdit(runId: string, leadId: string): Promise<boolean>; now(): number }
```

- Behaviour:
  - `processDeepFindLead` builds `QueueInput` from data it already holds (people looked up, confirmed domains with provider, the checked-email map, saved lead and contact addresses) and calls `enqueueLeadChecks`. It adds one step line: `N more addresses are being checked in the background. Results update this lead when they finish.` It adds nothing when the plan is empty. The first pass's own behaviour, limits and lines are otherwise unchanged.
  - `drainQueue` loops while `now() - startedAt < wallBudgetMs - 40_000`: `deep_find_checks_expire`, then `deep_find_checks_claim(5)`; for each row check `canStillEdit` (else finish `skipped`, reason `no_access`), call the worker (smtp through `verifyEmail` with the run's gate so pacing is shared; ms through `msExists`), apply `nextStep`, call `deep_find_checks_finish`, and on `done` call `recordOutcome` (`checked_valid`, `checked_invalid`, `checked_unverifiable`; Microsoft rows record nothing in `email_outcomes`).
  - On `valid` or `exists` for a named person: `applyProven` fills the contact's email only when it is blank (existing blank-only guard, `include_in_sequences` untouched, a lead note in the existing auto-apply wording); when the contact already has a different address it becomes a suggestion; then `siblingsToSkip` rows are finished `skipped`, reason `person_done`; then `refreshReadiness`.
  - On `invalid` for a saved address nothing is deleted; `refreshReadiness` runs so the tier becomes `never`.
  - `run-verify-queue` accepts only the cron secret (`cronSecretMatches`), wall budget 140,000 ms, and returns `{ processed }`.

- [ ] **Step 1: Write the failing tests** in `src/lib/verifyQueue.test.js` with fake deps: (a) a valid answer records `checked_valid`, calls `applyProven`, skips the person's other rows and refreshes readiness once; (b) a timeout re-queues with the 90 s delay and records nothing; (c) a row whose creator lost access is skipped and the worker is never called; (d) `limit_reached` skips the row and stops claiming for that organisation in this tick; (e) the loop stops claiming when less than 40 s of wall budget remains; (f) a Microsoft `not_found` finishes `done` and records no email outcome; (h) Review Focus 3: a contact whose saved address finished `invalid` and whose guessed format finished `valid` gets `applyProven` returning `suggested`, the saved address is not changed or deleted, and readiness is refreshed; (i) Review Focus 5: when `canStillEdit` is false because the run was cancelled or the lead deleted, `applyProven`, `recordOutcome` and `refreshReadiness` are never called; (g) Review Focus 2: two rows for the same address from two leads in one run are impossible because enqueue is unique on `(run_id, address, kind)`, asserted through the fake RPC returning 1 inserted for 2 offered.
- [ ] **Step 2: Run** `npx vitest run src/lib/verifyQueue.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Record the automation in `docs/AUTOMATIONS.md` (trigger: cron every minute; changes: queue rows, `email_outcomes`, blank contact emails, lead readiness; owner: Deep find).
- [ ] **Step 4: Run** all gates in Global Constraints. Expected: PASS.
- [ ] **Step 5: Commit** `feat: background queue checks every remaining address after Deep find`.

### Task 10: Show queued checks, and the scoring script

**Files:**
- Create: `src/components/deepfind/QueuedChecksLine.tsx`, `src/components/deepfind/QueuedChecksLine.test.tsx`, `scripts/deepfind-score.sql`
- Modify: the Deep find run result row component that renders a lead's step lines (add the line under the steps)

**Interfaces:**
- `QueuedChecksLine({ leadId, runId })` reads `deep_find_check_queue` counts for that lead and run through the session client every 30 s while any row is `queued` or `running`. Copy: loading shows nothing; `N addresses still being checked` while any remain; `Background checks finished: A confirmed, B not real, C could not be confirmed` when none remain and at least one row exists; nothing when no rows exist; `Background check status is unavailable` on a read error.
- `scripts/deepfind-score.sql` takes a pipeline id as `:pipeline_id` and returns one row with: leads, leads with at least one T1 or T2 address (`readiness = 'ready'`), leads with a non-dismissed person whose title is set, leads with a non-dismissed person with `linkedin_url`, leads with 2 or more of (ready email, phone on lead or person, LinkedIn on a person), leads flagged `company_match`, and queue totals by verdict and by provider. Read-only, no writes, no functions created.

- [ ] **Step 1: Write the failing component tests** for the five copy states.
- [ ] **Step 2: Run** `npx vitest run src/components/deepfind/QueuedChecksLine.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the component (under 150 lines, per-instance interval cleared on unmount) and the script.
- [ ] **Step 4: Run** all gates. Expected: PASS.
- [ ] **Step 5: Commit** `feat: show background email checks and add the pass-mark scoring script`.

### Task 11: Build report and handoff

- [ ] **Step 1: Write** `docs/VERIFIER-V2-BUILD-REPORT.md`: commits, final gate counts, every changed existing test assertion, deviations, open questions, and the list of what was not run (migration 075, audit, Deno, live worker, Microsoft, browser).
- [ ] **Step 2: Add** a checkpoint block at the top of `docs/HANDOFF.md` naming the branch, the final commit and "independent review pending".
- [ ] **Step 3: Commit** `docs: verifier v2 build report`. Stop.

---

## Rollout (Claude, after review, each step on Kevin's yes)

1. Review the branch against this plan and the spec; re-run all gates.
2. Stage 0 work that is Claude's, before scoring: build the 50-lead "Deep find test set" pipeline in the DI Dreamlabs org; validate the Microsoft check on 40 or more addresses with known truth; ask Kevin for the Google usage page reading to find the Gemini drain.
3. Dry-run migration 075 (guard removed) with a trailing `RAISE`, then apply; run the audit's read-only blocks.
4. Hostinger snapshot; redeploy the VPS wrapper; confirm `/ms-exists` and `/verify-email` answer; n8n and Postiz untouched.
5. Update the production `usage_resources` row `worker_verify` to 1,500 and 3,000.
6. Deploy `run-verify-queue` and every function that imports the changed shared modules; then merge and push; verify the live bundle.
7. Run Deep find on the test set, run `scripts/deepfind-score.sql`, report the six numbers against the pass marks.
