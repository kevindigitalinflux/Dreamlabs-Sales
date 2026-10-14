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
