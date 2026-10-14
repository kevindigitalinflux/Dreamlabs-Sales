# Worker integration, Stage 1 (Deep find) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deep find uses the live lookup worker: our own email checker before spending Hunter credits, and the site scraper where the page read finds no addresses.

**Architecture:** An import-free rules module (`workerRules.ts`, node-testable) holds every decision; a thin client (`workerClient.ts`) reserves usage, calls the worker with a secret header, refunds at most once, and fails closed; `deepFind.ts` calls the client at two existing points (the built-address verification and, new, one scrape per lead). With the worker off, down or over its limit, Deep find behaves exactly as today and says why a step was skipped.

**Tech Stack:** Deno edge functions (Supabase), TypeScript strict, vitest in node (tests in `src/lib/` import `../../supabase/functions/_shared/<file>` WITHOUT the `.ts` extension).

**Spec:** `docs/superpowers/specs/2026-10-14-worker-integration-design.md` (Stage 1 only; Stage 2 gets its own spec and plan).

## Global Constraints
- Reserve usage with `reserveUsage` from `_shared/usage.ts` BEFORE every worker request; refund with `refundUsage` (passing the `day` the reserve returned) AT MOST ONCE and ONLY when the worker did no work; any reserve error means "not allowed" (fail closed).
- Unit costs: `worker_scrape` 1 unit for `homepage` and `key_pages`, 3 for `deep`; `worker_verify` 1; `worker_fetch` 1.
- Worker config comes only from edge-function secrets `WORKER_URL` (must be `https:`) and `WORKER_SECRET`. Never log, return, store or put the secret, the worker address or raw worker/provider text in any step line, result or error.
- Only an address the checker calls `valid` is filled in automatically; `risky`/`unverifiable` (catch-all domains included) are NEVER treated as valid; Hunter's verifier is used only when the checker cannot decide and Hunter credits remain; nothing found or guessed is added to sequences.
- Worker output is untrusted: re-validate every address, accept scraped addresses only on the lead's own confirmed domain, cap sizes.
- Plain-English step lines; no new database tables or migrations in this stage.
- Stage files: edge-function code under `supabase/functions/_shared/` (imports use the `.ts` extension); tests under `src/lib/`.
- Never `git add .` / `-A`; stage explicit paths. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never touch the live database or run SQL; never deploy edge functions (the controller does).

## Review Focus
1. A scraped address on a DIFFERENT domain than the lead's confirmed one must be ignored (test in Task 1).
2. A catch-all or provider-blocked result must never end up as "valid" or auto-filled (Task 1).
3. Refund happens exactly once and only when no work happened; a completed call that found nothing is never refunded (Task 2).
4. With `WORKER_URL`/`WORKER_SECRET` missing, nothing is reserved, nothing is called, and Deep find output differs from today only by one plain "not set up" line (Tasks 2 and 3).
5. A worker call must not start when the lead's time budget cannot cover it (Tasks 3 and 4: `left()` guards), and one failing kind (limit/busy/unreachable) must stop further calls of that kind for the lead rather than repeating slow failures.

## File Structure
- Create `supabase/functions/_shared/workerRules.ts` — pure rules, types, lines (Task 1)
- Create `src/lib/workerRules.test.ts` (Task 1)
- Create `supabase/functions/_shared/workerClient.ts` — the client (Task 2)
- Create `src/lib/workerClient.test.ts` (Task 2)
- Modify `supabase/functions/_shared/deepFind.ts` — email check order (Task 3) and scrape step (Task 4)

---

### Task 1: Worker rules (pure)

**Files:**
- Create: `supabase/functions/_shared/workerRules.ts`
- Test: `src/lib/workerRules.test.ts`

**Interfaces:**
- Consumes: `UsageResource` type from `./usageRules.ts` (import type only).
- Produces (exact names, used by Tasks 2 to 4):
  - types `ScrapeMode`, `WorkerFailure`, `WorkerConfig`, `VerifyVerdict`, `VerifyReply`, `ScrapeFound`, `VerifyAction`
  - `readWorkerConfig(url, secret): WorkerConfig | null`
  - consts `SCRAPE_UNITS`, `WORKER_TIMEOUT_MS`, `WORKER_RESOURCE`, `MAX_VERIFY_PER_LEAD`
  - `failureForStatus(status: number): WorkerFailure | null`, `shouldRefund(f: WorkerFailure): boolean`
  - `parseVerifyReply(raw: unknown, expectedEmail: string): VerifyReply | null`
  - `parseScrapeReply(raw: unknown, domain: string): ScrapeFound | null`
  - `verifyAction(status: VerifyVerdict | null, hunterAvailable: boolean): VerifyAction`
  - `unconfirmedLabel(reason: string): string`
  - `workerFailureLine(f: WorkerFailure): string`, `verifyTallyLine(t): string | null`, `scrapeLine(domain, found): string`

- [ ] **Step 1: Write the failing test** — create `src/lib/workerRules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_VERIFY_PER_LEAD, SCRAPE_UNITS, WORKER_RESOURCE, failureForStatus, parseScrapeReply, parseVerifyReply, readWorkerConfig,
  scrapeLine, shouldRefund, unconfirmedLabel, verifyAction, verifyTallyLine, workerFailureLine,
} from '../../supabase/functions/_shared/workerRules';

describe('readWorkerConfig', () => {
  it('needs both values and an https address', () => {
    expect(readWorkerConfig('https://lookup.didreamlabs.com/', ' s3cret ')).toEqual({ url: 'https://lookup.didreamlabs.com', secret: 's3cret' });
    expect(readWorkerConfig(undefined, 'x')).toBeNull();
    expect(readWorkerConfig('https://a.example', '')).toBeNull();
    expect(readWorkerConfig('https://a.example', '   ')).toBeNull();
    expect(readWorkerConfig('http://a.example', 'x')).toBeNull();
    expect(readWorkerConfig('not a url', 'x')).toBeNull();
  });
});

describe('costs and mapping', () => {
  it('charges 3 units for a deep scrape and 1 otherwise', () => {
    expect(SCRAPE_UNITS).toEqual({ homepage: 1, key_pages: 1, deep: 3 });
    expect(WORKER_RESOURCE).toEqual({ scrape: 'worker_scrape', verify: 'worker_verify', fetch: 'worker_fetch' });
    expect(MAX_VERIFY_PER_LEAD).toBe(6);
  });
  it('maps http statuses to failures', () => {
    expect(failureForStatus(200)).toBeNull();
    expect(failureForStatus(204)).toBeNull();
    expect(failureForStatus(401)).toBe('not_configured');
    expect(failureForStatus(403)).toBe('not_configured');
    expect(failureForStatus(429)).toBe('busy');
    expect(failureForStatus(500)).toBe('unreachable');
    expect(failureForStatus(503)).toBe('unreachable');
    expect(failureForStatus(504)).toBe('unreachable');
    expect(failureForStatus(400)).toBe('bad_response');
    expect(failureForStatus(422)).toBe('bad_response');
  });
  it('refunds only when the worker did no work', () => {
    expect(shouldRefund('busy')).toBe(true);
    expect(shouldRefund('unreachable')).toBe(true);
    expect(shouldRefund('not_configured')).toBe(true);
    expect(shouldRefund('bad_response')).toBe(false);
    expect(shouldRefund('limit_reached')).toBe(false);
  });
});

describe('parseVerifyReply', () => {
  it('accepts a well-formed reply for the expected address', () => {
    expect(parseVerifyReply({ email: 'Max@LoveLiving.uk', status: 'valid', reason: 'deliverable' }, 'max@loveliving.uk'))
      .toEqual({ status: 'valid', reason: 'deliverable' });
  });
  it('keeps risky and unverifiable and never upgrades them', () => {
    expect(parseVerifyReply({ email: 'a@b.co', status: 'risky', reason: 'catch_all' }, 'a@b.co')).toEqual({ status: 'risky', reason: 'catch_all' });
    expect(parseVerifyReply({ email: 'a@b.co', status: 'unverifiable', reason: 'provider_blocks_checks' }, 'a@b.co')).toEqual({ status: 'unverifiable', reason: 'provider_blocks_checks' });
  });
  it('rejects a reply for another address, an unknown status or junk', () => {
    expect(parseVerifyReply({ email: 'other@b.co', status: 'valid', reason: 'deliverable' }, 'a@b.co')).toBeNull();
    expect(parseVerifyReply({ email: 'a@b.co', status: 'deliverable', reason: 'x' }, 'a@b.co')).toBeNull();
    expect(parseVerifyReply(null, 'a@b.co')).toBeNull();
    expect(parseVerifyReply('valid', 'a@b.co')).toBeNull();
  });
  it('turns an unknown reason into "unknown" instead of passing raw text through', () => {
    expect(parseVerifyReply({ email: 'a@b.co', status: 'risky', reason: 'smtp said: <script>' }, 'a@b.co')).toEqual({ status: 'risky', reason: 'unknown' });
  });
  it('refuses to call a catch-all result valid', () => {
    expect(parseVerifyReply({ email: 'a@b.co', status: 'valid', reason: 'catch_all' }, 'a@b.co')).toEqual({ status: 'risky', reason: 'catch_all' });
  });
});

describe('parseScrapeReply', () => {
  const reply = {
    domain: 'loveliving.uk',
    emails: [
      { value: 'Max@loveliving.uk', sources: ['https://loveliving.uk/team', 'http://evil.example/x'], is_likely_official: true },
      { value: 'david@loveliving.uk', sources: [] },
      { value: 'someone@other.com', sources: ['https://loveliving.uk/'] },
      { value: 'not an email' },
      { value: 'dup@loveliving.uk' }, { value: 'DUP@loveliving.uk' },
    ],
    phones: [{ value: '+44 20 7946 0958', sources: ['https://loveliving.uk/contact'] }, { value: '12', sources: [] }, { value: 'call me <b>', sources: [] }],
    error: 'scrape_incomplete',
  };
  it('keeps only addresses on the lead domain, lowercased, deduplicated, with a safe source', () => {
    const f = parseScrapeReply(reply, 'loveliving.uk')!;
    expect(f.emails).toEqual([
      { value: 'max@loveliving.uk', source: 'https://loveliving.uk/team' },
      { value: 'david@loveliving.uk', source: null },
      { value: 'dup@loveliving.uk', source: null },
    ]);
  });
  it('keeps plausible phone numbers only', () => {
    expect(parseScrapeReply(reply, 'loveliving.uk')!.phones).toEqual([{ value: '+44 20 7946 0958', source: 'https://loveliving.uk/contact' }]);
  });
  it('ignores addresses on a different domain (Review Focus 1)', () => {
    expect(parseScrapeReply({ emails: [{ value: 'x@other.com' }], phones: [] }, 'loveliving.uk')).toEqual({ emails: [], phones: [] });
  });
  it('caps sizes and tolerates missing arrays', () => {
    const many = { emails: Array.from({ length: 40 }, (_, i) => ({ value: `p${i}@a.co` })), phones: [] };
    expect(parseScrapeReply(many, 'a.co')!.emails).toHaveLength(10);
    expect(parseScrapeReply({}, 'a.co')).toEqual({ emails: [], phones: [] });
    expect(parseScrapeReply(null, 'a.co')).toBeNull();
    expect(parseScrapeReply([], 'a.co')).toBeNull();
  });
});

describe('verifyAction (Hunter only when the checker cannot decide)', () => {
  it('valid is accepted and invalid dropped, whatever Hunter has', () => {
    expect(verifyAction('valid', true)).toBe('accept');
    expect(verifyAction('valid', false)).toBe('accept');
    expect(verifyAction('invalid', true)).toBe('drop');
  });
  it('risky, unverifiable and a failed check ask Hunter when it is available, else become a suggestion', () => {
    for (const s of ['risky', 'unverifiable', null] as const) {
      expect(verifyAction(s, true)).toBe('ask_hunter');
      expect(verifyAction(s, false)).toBe('suggest');
    }
  });
});

describe('plain-English text', () => {
  it('explains an unconfirmed address', () => {
    expect(unconfirmedLabel('catch_all')).toBe('Built from the email format. The mail server accepts any address, so it cannot be confirmed, check it');
    expect(unconfirmedLabel('provider_blocks_checks')).toBe('Built from the email format. The mail provider does not allow checks, so it cannot be confirmed, check it');
    expect(unconfirmedLabel('whatever')).toBe('Built from the email format. Our email checker could not confirm it, check it');
  });
  it('words each failure without naming the worker address', () => {
    for (const f of ['not_configured', 'limit_reached', 'busy', 'unreachable', 'bad_response'] as const) {
      const line = workerFailureLine(f);
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toMatch(/https?:|didreamlabs|secret/i);
    }
    expect(workerFailureLine('not_configured')).toBe('The lookup worker is not set up, so it was not used.');
  });
  it('words the tally and the scrape result', () => {
    expect(verifyTallyLine({ checked: 0, valid: 0, invalid: 0, undecided: 0 })).toBeNull();
    expect(verifyTallyLine({ checked: 3, valid: 2, invalid: 0, undecided: 1 })).toBe('Checked 3 email addresses with our own checker (2 valid, 0 not real, 1 could not be confirmed).');
    expect(verifyTallyLine({ checked: 1, valid: 1, invalid: 0, undecided: 0 })).toBe('Checked 1 email address with our own checker (1 valid, 0 not real, 0 could not be confirmed).');
    expect(scrapeLine('loveliving.uk', { emails: [{ value: 'a@loveliving.uk', source: null }], phones: [] }))
      .toBe('Read loveliving.uk with the browser scraper: found 1 address and 0 phone numbers.');
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run src/lib/workerRules.test.ts`. Expected: FAIL, cannot resolve `workerRules`.

- [ ] **Step 3: Write the implementation** — create `supabase/functions/_shared/workerRules.ts`:

```ts
// supabase/functions/_shared/workerRules.ts
// Pure rules for calling the shared lookup worker (import-free apart from a type): used by the edge functions (Deno)
// and tested from src/lib. Nothing here touches the network, the database or Deno.
import type { UsageResource } from './usageRules.ts';

export type ScrapeMode = 'homepage' | 'key_pages' | 'deep';
export type WorkerFailure = 'not_configured' | 'limit_reached' | 'busy' | 'unreachable' | 'bad_response';
export interface WorkerConfig { url: string; secret: string }

export const SCRAPE_UNITS: Record<ScrapeMode, number> = { homepage: 1, key_pages: 1, deep: 3 };
export const WORKER_TIMEOUT_MS = { scrape: 45_000, verify: 20_000, fetch: 12_000 } as const;
export const WORKER_RESOURCE: Record<'scrape' | 'verify' | 'fetch', UsageResource> = {
  scrape: 'worker_scrape', verify: 'worker_verify', fetch: 'worker_fetch',
};
/** Most email checks one lead may use in one Deep find. */
export const MAX_VERIFY_PER_LEAD = 6;

/** Both values present and an https address; anything else means "not set up". */
export function readWorkerConfig(url: string | undefined | null, secret: string | undefined | null): WorkerConfig | null {
  if (!url || !secret || !secret.trim()) return null;
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  return { url: parsed.origin, secret: secret.trim() };
}

/** HTTP status from the worker to a failure; null when the call did its work (2xx). */
export function failureForStatus(status: number): WorkerFailure | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return 'not_configured';
  if (status === 429) return 'busy';
  if (status >= 500) return 'unreachable';
  return 'bad_response';
}

/** Give the units back only when the worker did no work. A completed call is never refunded. */
export function shouldRefund(failure: WorkerFailure): boolean {
  return failure === 'busy' || failure === 'unreachable' || failure === 'not_configured';
}

// ---------- email check ----------
export type VerifyVerdict = 'valid' | 'invalid' | 'risky' | 'unverifiable';
export interface VerifyReply { status: VerifyVerdict; reason: string }
const VERDICTS = new Set<string>(['valid', 'invalid', 'risky', 'unverifiable']);
const REASONS = new Set<string>([
  'deliverable', 'bad_syntax', 'no_mail_server', 'mailbox_missing', 'mailbox_disabled', 'catch_all', 'disposable',
  'full_inbox', 'role_account', 'provider_blocks_checks', 'unknown', 'checker_error',
]);

/** Validates the worker's /verify-email reply for the address we asked about. A catch-all can never be "valid". */
export function parseVerifyReply(raw: unknown, expectedEmail: string): VerifyReply | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.email !== 'string' || r.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) return null;
  if (typeof r.status !== 'string' || !VERDICTS.has(r.status)) return null;
  const reason = typeof r.reason === 'string' && REASONS.has(r.reason) ? r.reason : 'unknown';
  if (r.status === 'valid' && reason === 'catch_all') return { status: 'risky', reason };
  return { status: r.status as VerifyVerdict, reason };
}

export type VerifyAction = 'accept' | 'drop' | 'ask_hunter' | 'suggest';

/** What to do with a built address. `status` is null when our checker gave no answer. */
export function verifyAction(status: VerifyVerdict | null, hunterAvailable: boolean): VerifyAction {
  if (status === 'valid') return 'accept';
  if (status === 'invalid') return 'drop';
  return hunterAvailable ? 'ask_hunter' : 'suggest';
}

export function unconfirmedLabel(reason: string): string {
  if (reason === 'catch_all') return 'Built from the email format. The mail server accepts any address, so it cannot be confirmed, check it';
  if (reason === 'provider_blocks_checks') return 'Built from the email format. The mail provider does not allow checks, so it cannot be confirmed, check it';
  return 'Built from the email format. Our email checker could not confirm it, check it';
}

// ---------- site scraper ----------
export interface ScrapeFound {
  emails: Array<{ value: string; source: string | null }>;
  phones: Array<{ value: string; source: string | null }>;
}
const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@([a-z0-9-]{1,63}\.)+[a-z]{2,24}$/;
const MAX_EMAILS = 10;
const MAX_PHONES = 5;

function firstHttpsSource(item: unknown, domain: string): string | null {
  const sources = item && typeof item === 'object' ? (item as { sources?: unknown }).sources : null;
  if (!Array.isArray(sources)) return null;
  for (const s of sources) {
    if (typeof s !== 'string' || s.length > 500) continue;
    try {
      const u = new URL(s);
      if (u.protocol === 'https:' && (u.hostname === domain || u.hostname.endsWith(`.${domain}`))) return u.toString();
    } catch { /* skip */ }
  }
  return null;
}

/** Keeps only addresses on `domain` (the lead's confirmed domain) and plausible phone numbers; caps sizes. */
export function parseScrapeReply(raw: unknown, domain: string): ScrapeFound | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { emails?: unknown; phones?: unknown };
  const d = domain.trim().toLowerCase();
  const emails: ScrapeFound['emails'] = [];
  for (const item of Array.isArray(r.emails) ? r.emails : []) {
    const value = item && typeof item === 'object' ? (item as { value?: unknown }).value : null;
    if (typeof value !== 'string') continue;
    const email = value.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.split('@')[1] !== d || emails.some((e) => e.value === email)) continue;
    emails.push({ value: email, source: firstHttpsSource(item, d) });
    if (emails.length >= MAX_EMAILS) break;
  }
  const phones: ScrapeFound['phones'] = [];
  for (const item of Array.isArray(r.phones) ? r.phones : []) {
    const value = item && typeof item === 'object' ? (item as { value?: unknown }).value : null;
    if (typeof value !== 'string') continue;
    const phone = value.trim();
    const digits = phone.replace(/\D/g, '').length;
    if (!/^\+?[\d\s().-]{7,25}$/.test(phone) || digits < 7 || digits > 15 || phones.some((p) => p.value === phone)) continue;
    phones.push({ value: phone, source: firstHttpsSource(item, d) });
    if (phones.length >= MAX_PHONES) break;
  }
  return { emails, phones };
}

// ---------- plain-English lines ----------
export function workerFailureLine(failure: WorkerFailure): string {
  switch (failure) {
    case 'not_configured': return 'The lookup worker is not set up, so it was not used.';
    case 'limit_reached': return 'The lookup worker was skipped because a daily limit was reached.';
    case 'busy': return 'The lookup worker was busy, so it was skipped.';
    case 'unreachable': return 'The lookup worker could not be reached, so it was skipped.';
    case 'bad_response': return 'The lookup worker sent an answer that could not be used.';
  }
}

export interface VerifyTally { checked: number; valid: number; invalid: number; undecided: number }

export function verifyTallyLine(t: VerifyTally): string | null {
  if (t.checked <= 0) return null;
  return `Checked ${t.checked} email address${t.checked === 1 ? '' : 'es'} with our own checker (${t.valid} valid, ${t.invalid} not real, ${t.undecided} could not be confirmed).`;
}

export function scrapeLine(domain: string, found: ScrapeFound): string {
  const e = found.emails.length;
  const p = found.phones.length;
  return `Read ${domain} with the browser scraper: found ${e} address${e === 1 ? '' : 'es'} and ${p} phone number${p === 1 ? '' : 's'}.`;
}
```

- [ ] **Step 4: Run it to see it pass** — `npx vitest run src/lib/workerRules.test.ts`. Expected: all pass. Then `npx tsc --noEmit` (clean).

- [ ] **Step 5: Commit** — `git add supabase/functions/_shared/workerRules.ts src/lib/workerRules.test.ts` and commit `feat: pure rules for calling the lookup worker` with the trailer.

---

### Task 2: Worker client

**Files:**
- Create: `supabase/functions/_shared/workerClient.ts`
- Test: `src/lib/workerClient.test.ts`

**Interfaces:**
- Consumes: `reserveUsage`, `refundUsage`, `UsageClient` from `./usage.ts`; `refusalLine` from `./usageRules.ts`; everything listed under Task 1 "Produces".
- Produces:
  - `type WorkerResult<T> = { ok: true; value: T } | { ok: false; failure: WorkerFailure; line: string }`
  - `interface WorkerClient { verifyEmail(email: string): Promise<WorkerResult<VerifyReply>>; scrapeSite(domain: string, mode?: ScrapeMode): Promise<WorkerResult<ScrapeFound>>; lines(): string[] }`
  - `makeWorkerClient(opts: { usage: UsageClient; orgId: string; config: WorkerConfig | null; fetchImpl?: typeof fetch }): WorkerClient`

Behaviour (all covered by the tests below):
- Per kind (`verify`, `scrape`) the client is "stopped" after `limit_reached`, `not_configured`, `busy` or `unreachable`: later calls of that kind return the same failure immediately WITHOUT reserving or calling. `bad_response` does not stop it.
- Config null: returns `not_configured` before any reserve or fetch.
- Verify is capped at `MAX_VERIFY_PER_LEAD` calls per client; the 7th returns `limit_reached` with a fixed line and stops verify.
- Request: `POST {config.url}/verify-email` body `{email}` or `/scrape-site` body `{url: 'https://<domain>', mode}`, headers `content-type: application/json` and `x-worker-secret`; abort after `WORKER_TIMEOUT_MS[kind]`; a network error or abort is `unreachable`.
- Order: config check, reserve (units from `SCRAPE_UNITS` / 1), request, refund once if `shouldRefund(failure)`.
- `lines()` returns, de-duplicated and in this order: the verify tally line (from counts of ok verifies), the scrape line (when a scrape succeeded), then each distinct failure/refusal line.

- [ ] **Step 1: Write the failing test** — create `src/lib/workerClient.test.ts`. First read `src/lib/usageServer.test.ts` and `supabase/functions/_shared/usageRules.ts` (`parseReserve`) to copy the exact reply shapes for an allowed and a refused `usage_reserve`. Build a fake `UsageClient` that records `rpc` calls and replies per function name, and a fake `fetchImpl` (a `vi.fn` returning `new Response(JSON.stringify(body), { status })`). Tests (names and assertions are required; keep fixtures small):

```ts
// helper sketches (write them out fully in the test file)
// usage(allowed|refused): UsageClient & { calls: [fn, args][] }
// worker(status, body): typeof fetch & { mock }  -> records url, init
describe('makeWorkerClient', () => {
  it('returns not_configured without reserving or calling when there is no config', ...)       // calls.length===0, fetch not called, line 'The lookup worker is not set up, so it was not used.'
  it('reserves before it calls, sends the secret header, and does not refund a completed verify', ...) // call order: usage_reserve (p_resource 'worker_verify', p_units 1) then fetch; headers x-worker-secret; no usage_refund
  it('maps a valid reply to ok and counts it in the tally line', ...)
  it('treats a reply for another address as bad_response, keeps the units, and does not stop later checks', ...) // no refund; next call still reserves
  it('refunds exactly once, with the reserve day, when the worker is unreachable, and then stops that kind', ...) // fetch rejects -> usage_refund args {p_org,p_resource,p_units:1,p_day:'2026-10-14'} once; second call: no new reserve/fetch/refund
  it('refunds once on 429 (busy) and once on 503, never on 422', ...)
  it('does not call the worker when the reserve is refused, and uses the usage wording', ...) // line === refusalLine('org_limit','worker_verify',150) style from usageRules; failure 'limit_reached'; no fetch
  it('fails closed when the reserve call errors', ...)  // failure 'limit_reached', no fetch
  it('keeps verify and scrape independent: a refused scrape does not stop verify', ...)
  it('caps email checks at 6 per client', ...)  // 7th -> limit_reached, no 7th reserve
  it('charges 3 units for a deep scrape and 1 for key_pages', ...)
  it('scrape keeps only addresses on the domain and phrases the result', ...) // lines() contains 'Read loveliving.uk with the browser scraper: found 1 address and 0 phone numbers.'
  it('aborts a slow call and reports unreachable', ...) // use vi.useFakeTimers; fetch that never resolves until abort signal fires
  it('never puts the secret or the worker address into any line', ...) // join lines() for several failures; expect no 'didreamlabs', no secret
});
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run src/lib/workerClient.test.ts`. Expected: FAIL, cannot resolve `workerClient`.

- [ ] **Step 3: Implement** — create `supabase/functions/_shared/workerClient.ts`:

```ts
// supabase/functions/_shared/workerClient.ts
// Calls the shared lookup worker for one lead. Reserve usage BEFORE the request, refund at most once and only when
// the worker did no work, fail closed. Never logs or returns the secret, the address or raw worker text.
import { refundUsage, reserveUsage, type UsageClient } from './usage.ts';
import { refusalLine } from './usageRules.ts';
import {
  MAX_VERIFY_PER_LEAD, SCRAPE_UNITS, WORKER_RESOURCE, WORKER_TIMEOUT_MS, failureForStatus, parseScrapeReply, parseVerifyReply,
  scrapeLine, shouldRefund, verifyTallyLine, workerFailureLine,
  type ScrapeFound, type ScrapeMode, type VerifyReply, type WorkerConfig, type WorkerFailure,
} from './workerRules.ts';

export type WorkerResult<T> = { ok: true; value: T } | { ok: false; failure: WorkerFailure; line: string };

export interface WorkerClient {
  verifyEmail(email: string): Promise<WorkerResult<VerifyReply>>;
  scrapeSite(domain: string, mode?: ScrapeMode): Promise<WorkerResult<ScrapeFound>>;
  /** Plain step lines for the Deep find result: the check tally, the scrape result, then each distinct skip reason. */
  lines(): string[];
}

export interface WorkerClientOptions { usage: UsageClient; orgId: string; config: WorkerConfig | null; fetchImpl?: typeof fetch }

type Kind = 'verify' | 'scrape';
type Stopped = { failure: WorkerFailure; line: string };
type RawResult = { ok: true; json: unknown } | { ok: false; failure: WorkerFailure; line: string };

export function makeWorkerClient(opts: WorkerClientOptions): WorkerClient {
  const { usage, orgId, config } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const stopped: Partial<Record<Kind, Stopped>> = {};
  const failureLines: string[] = [];
  const tally = { checked: 0, valid: 0, invalid: 0, undecided: 0 };
  let verifyCalls = 0;
  let scrapeSummary: string | null = null;

  const addLine = (line: string) => { if (line && !failureLines.includes(line)) failureLines.push(line); };
  const stop = (kind: Kind, failure: WorkerFailure, line: string): RawResult => {
    stopped[kind] = { failure, line };
    addLine(line);
    return { ok: false, failure, line };
  };

  async function call(kind: Kind, units: number, path: string, body: unknown): Promise<RawResult> {
    const already = stopped[kind];
    if (already) return { ok: false, ...already };
    if (!config) return stop(kind, 'not_configured', workerFailureLine('not_configured'));
    const resource = WORKER_RESOURCE[kind];
    const reserve = await reserveUsage(usage, orgId, resource, units);
    if (!reserve.ok) return stop(kind, 'limit_reached', refusalLine(reserve.reason, resource, reserve.limit));

    let failure: WorkerFailure | null = null;
    let json: unknown = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS[kind]);
    try {
      const res = await fetchImpl(`${config.url}${path}`, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-worker-secret': config.secret },
        body: JSON.stringify(body),
      });
      failure = failureForStatus(res.status);
      if (failure === null) {
        try { json = await res.json(); } catch { failure = 'bad_response'; }
      } else {
        try { await res.body?.cancel(); } catch { /* nothing to cancel */ }
      }
    } catch {
      failure = 'unreachable';
    } finally {
      clearTimeout(timer);
    }
    if (failure === null) return { ok: true, json };
    if (shouldRefund(failure)) await refundUsage(usage, orgId, resource, units, reserve.day);
    const line = workerFailureLine(failure);
    if (failure === 'bad_response') { addLine(line); return { ok: false, failure, line }; }
    return stop(kind, failure, line);
  }

  return {
    async verifyEmail(email) {
      if (verifyCalls >= MAX_VERIFY_PER_LEAD) {
        return stop('verify', 'limit_reached', `Only ${MAX_VERIFY_PER_LEAD} email checks are used for one lead in one Deep find.`);
      }
      verifyCalls++;
      const raw = await call('verify', 1, '/verify-email', { email });
      if (!raw.ok) return raw;
      const reply = parseVerifyReply(raw.json, email);
      if (!reply) { const line = workerFailureLine('bad_response'); addLine(line); return { ok: false, failure: 'bad_response', line }; }
      tally.checked++;
      if (reply.status === 'valid') tally.valid++;
      else if (reply.status === 'invalid') tally.invalid++;
      else tally.undecided++;
      return { ok: true, value: reply };
    },
    async scrapeSite(domain, mode = 'key_pages') {
      const raw = await call('scrape', SCRAPE_UNITS[mode], '/scrape-site', { url: `https://${domain}`, mode });
      if (!raw.ok) return raw;
      const found = parseScrapeReply(raw.json, domain);
      if (!found) { const line = workerFailureLine('bad_response'); addLine(line); return { ok: false, failure: 'bad_response', line }; }
      scrapeSummary = scrapeLine(domain, found);
      return { ok: true, value: found };
    },
    lines() {
      return [verifyTallyLine(tally), scrapeSummary, ...failureLines].filter((l): l is string => !!l);
    },
  };
}
```

- [ ] **Step 4: Run it to see it pass** — `npx vitest run src/lib/workerClient.test.ts`, then `npx vitest run` (whole suite green) and `npx tsc --noEmit`. If a test reveals a wrong assumption in the sketch above (for example the exact reply shape of `usage_reserve`), fix the TEST fixture to match `parseReserve`, never loosen the client's rules; if the client itself is wrong, fix it and say so in your report.

- [ ] **Step 5: Commit** — stage the two files; message `feat: lookup worker client (reserve first, refund once, fail closed)`.

---

### Task 3: Deep find uses the email checker first

**Files:**
- Modify: `supabase/functions/_shared/deepFind.ts` (imports; per-lead client creation; the step "(1c)" candidate loop around lines 273 to 293; the final `steps.push(...problemLines(problems))`)

**Interfaces:**
- Consumes: `makeWorkerClient`, `readWorkerConfig`, `verifyAction`, `unconfirmedLabel`, `guessLabel` (already imported).
- Produces: `const worker` (a `WorkerClient`) in `processDeepFindLead`'s scope, used again by Task 4.

- [ ] **Step 1: Read first.** Read `deepFind.ts` lines 1 to 30 and 100 to 135 (imports, the per-lead setup, the `steps`/`suggestions`/`problems` arrays) and lines 252 to 296 (the 1c loop). Note that `deepFind.ts` is not imported by any test (it imports `npm:` packages), so this task is checked by type reading, a build of the edge function by the controller at deploy time, and the pure functions' tests from Task 1.

- [ ] **Step 2: Imports.** Add after the existing imports:

```ts
import { makeWorkerClient } from './workerClient.ts';
import { readWorkerConfig, unconfirmedLabel, verifyAction } from './workerRules.ts';
```

- [ ] **Step 3: Create the per-lead client** right after `const spend = new Spend(service, run.id);`:

```ts
  // The shared lookup worker (free email checker, site scraper). Off when WORKER_URL / WORKER_SECRET are not set.
  const worker = makeWorkerClient({
    usage: service, orgId: run.org_id,
    config: readWorkerConfig(Deno.env.get('WORKER_URL'), Deno.env.get('WORKER_SECRET')),
  });
```

- [ ] **Step 4: Replace the Hunter-only verification** inside the `for (const person of peopleToLookUp(...).slice(0, 5))` loop. The existing block from `let verdict: string | null = null;` through the `else { suggestions.push(...) }` becomes (keep the lines before `const name` and the `if (!guess ...) continue;` line unchanged):

```ts
      const name = `${person.first} ${person.last}`.slice(0, 80);
      let verdict: string | null = null;
      let label = guessLabel(pattern, d);
      // Free checker first; Hunter is asked only when it cannot decide and credits remain.
      const checked = left() > 25_000 ? await worker.verifyEmail(guess) : null;
      const action = verifyAction(checked && checked.ok ? checked.value.status : null, !!hunterKey && verifications < 3 && left() > 25_000);
      if (action === 'drop') continue;
      if (action === 'accept') {
        verdict = 'verified';
        label = 'Built from the email format and confirmed by our email checker, check it';
      } else if (action === 'ask_hunter' && await spend.hunter('verify email format')) {
        verifications++;
        const v = await hunterVerifyEmail(guess, hunterKey!, 5_000);
        if (v.ok) {
          verdict = v.verdict;
          if (verdict === 'verified') label = 'Built from the email format and verified by Hunter, check it';
        } else {
          problems.push({ step: 'hunter_verify', target: d, failure: safeFailure(v.failure) });
          if (v.failure === 'usage_exhausted' || v.failure === 'rate_limited') spend.stopHunter();
        }
      }
      if (verdict === 'invalid') continue;
      if (verdict !== 'verified' && checked && checked.ok) label = unconfirmedLabel(checked.value.reason);
      const contact = person.contactId ? all().find((c) => c.id === person.contactId) ?? null : null;
      if (verdict === 'verified' && contact) {
        const saved = await fillBlanks(service, contact, { email: guess });
        if (saved) { Object.assign(contact, saved); touched.add(contact.id); stats.officerEmails++; }
      } else {
        suggestions.push({ name, field: 'email', value: guess, label });
      }
```

(`hunterKey!` is safe: `verifyAction` only returns `ask_hunter` when `hunterKey` is truthy.) Keep the existing comment above the loop but change "verified with Hunter when credits allow" to "checked with our own checker first, then Hunter when it cannot decide and credits allow".

- [ ] **Step 5: Add the worker lines** immediately before `steps.push(...problemLines(problems));`:

```ts
  steps.push(...worker.lines());
```

- [ ] **Step 6: Review the edit** with `git diff supabase/functions/_shared/deepFind.ts`: no other behaviour changed, `Spend` untouched, no `console.log` of any worker value. Run `npx tsc --noEmit` and `npx vitest run` (both unchanged-green; this file is not type-checked by `tsc`, so also re-read your replacement against the surrounding variable names: `pattern`, `d`, `person`, `guess`, `contact`, `suggestions`, `touched`, `stats`, `fillBlanks`, `all`, `left`).

- [ ] **Step 7: Commit** — `git add supabase/functions/_shared/deepFind.ts`; message `feat: Deep find checks built emails with the lookup worker before Hunter`.

---

### Task 4: Deep find uses the site scraper where the page read finds nothing

**Files:**
- Modify: `supabase/functions/_shared/deepFind.ts` (right after the `for (const s of confirmedSites) { ... }` loop that fills `siteEmails`)

**Interfaces:**
- Consumes: `worker` from Task 3; `verified` (Set of confirmed domains), `siteEmails` (Map), `suggestions`, `emailOnLead`, `all`, `left`, `isDirectoryDomain` (all already in scope/imported).

- [ ] **Step 1: Add the scrape step** directly after that loop (before the `for (const person of confirmedSites.length > 0 ? ...` block):

```ts
  // (1b-scrape) A confirmed domain whose pages gave no address (a site that needs a browser, or one we could not read):
  // one browser scrape per lead. Only addresses on that domain are kept; they are suggestions with their source page
  // and also feed the email-format step below. Skipped when the worker is off, over its limit, or time is short.
  const scrapeDomain = [...verified].find((d) => (siteEmails.get(d) ?? []).length === 0 && !isDirectoryDomain(d));
  if (scrapeDomain && left() > 50_000) {
    const scraped = await worker.scrapeSite(scrapeDomain, 'key_pages');
    if (scraped.ok) {
      const pageOf = (source: string | null) => { try { return source ? ` (${new URL(source).pathname})` : ''; } catch { return ''; } };
      for (const e of scraped.value.emails) {
        if (emailOnLead(all(), e.value) || suggestions.some((s) => s.value === e.value)) continue;
        suggestions.push({ name: 'Company contact', field: 'email', value: e.value, label: `Found by the browser scraper on ${scrapeDomain}${pageOf(e.source)}, check it` });
      }
      for (const p of scraped.value.phones) {
        if (suggestions.some((s) => s.value === p.value)) continue;
        suggestions.push({ name: 'Company contact', field: 'phone', value: p.value, label: `Found by the browser scraper on ${scrapeDomain}${pageOf(p.source)}, check it` });
      }
      siteEmails.set(scrapeDomain, [...(siteEmails.get(scrapeDomain) ?? []), ...scraped.value.emails.map((e) => e.value)]);
    }
  }
```

- [ ] **Step 2: Check the phone suggestion is usable.** Read `src/components/pipeline/LookupSuggestions.tsx` and `src/components/deepfind/DeepFindLeadResult.tsx`. If suggestions of `field: 'phone'` can be applied by the existing UI (the `filled[s.field]` map and the apply handler), leave the code as is. If the UI only understands `email`, change the phone loop to push nothing and instead rely on the step line (the scrape summary line already counts phones); say which in your report.

- [ ] **Step 3: Review** with `git diff`; confirm the scrape happens at most once per lead (`find` returns one domain), costs one `worker_scrape` unit, and that nothing is stored on a contact. Run `npx tsc --noEmit` and `npx vitest run`.

- [ ] **Step 4: Commit** — `git add supabase/functions/_shared/deepFind.ts`; message `feat: Deep find scrapes a confirmed site with the lookup worker when the page read finds no address`.

---

### Task 5 (controller, not a subagent): deploy, secrets, live check, docs

- [ ] Type-check and deploy `run-deep-find` with the Supabase CLI (`npx supabase functions deploy run-deep-find --project-ref wgomksxelyfkzepbnkdd`); fix any Deno type error the deploy surfaces by returning to the implementer.
- [ ] Kevin sets the two secrets himself (the assistant never sees the values): `npx supabase secrets set WORKER_URL=https://lookup.didreamlabs.com` and `npx supabase secrets set WORKER_SECRET=<copied from /opt/lookup-worker/.env on the VPS>`; confirm with `npx supabase secrets list` (names only).
- [ ] Live check on the deployed app: run Deep find on a test lead (Love Living) and read the step lines: the scraper line, the checker tally, no Hunter credit spent for built addresses the checker decided; confirm the usage meter moved; confirm "not set up" line when the secrets are unset (optional, short).
- [ ] Update `CLAUDE.md` (entry "Worker integration Stage 1"), `docs/AUTOMATIONS.md`, memory; then Stage 2 spec.
