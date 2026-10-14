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
  const stop = (kind: Kind, failure: WorkerFailure, line: string): Extract<RawResult, { ok: false }> => {
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
      if (!raw.ok) return { ok: false, failure: raw.failure, line: raw.line };
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
      if (!raw.ok) return { ok: false, failure: raw.failure, line: raw.line };
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
