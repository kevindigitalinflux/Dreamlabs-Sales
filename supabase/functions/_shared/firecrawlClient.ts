import { cancelBody, readCapped } from './cappedBody.ts';
import { problemLines } from './deepFindProblems.ts';
import { chooseFirecrawlPage, firecrawlTimeoutFor, parseFirecrawlReply, FIRECRAWL_MAX_BYTES, FIRECRAWL_NOT_CONFIGURED, type FirecrawlTeam } from './firecrawlRules.ts';

const API = 'https://api.firecrawl.dev/v2';
const validKey = (value: string | null): value is string => !!value?.trim() && value.length <= 4096 && !/[\x00-\x20\x7f]/.test(value);

/** Read-only, bounded validation. Never send a scrape just to validate a credential. */
export async function validateFirecrawlKey(key: string, request: typeof fetch = fetch): Promise<string | null> {
  if (!validKey(key)) return 'Enter a valid Firecrawl API key.';
  try {
    const signal = AbortSignal.timeout(5000);
    const response = await request(`${API}/team/credit-usage`, { method: 'GET', redirect: 'error', signal, headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok) { await cancelBody(response); return 'Firecrawl rejected the key. Check it and try again.'; }
    const value = JSON.parse(await readCapped(response, signal, 20_000)) as { success?: boolean; data?: { remainingCredits?: number } };
    return value.success === true && typeof value.data?.remainingCredits === 'number' && Number.isFinite(value.data.remainingCredits)
      ? null : 'The Firecrawl key could not be verified. Try again.';
  } catch { return 'The Firecrawl key could not be verified. Try again.'; }
}

/** One instance per lead/run. A submitted page is counted even on timeout; no retries or silent credit refunds. */
export function makeFirecrawlClient(deps: { key: string | null; reserve(): Promise<boolean>; request?: typeof fetch; checkpoint?(): Promise<void> }) {
  const request = deps.request ?? fetch;
  let attempted = false;
  let used = 0;
  const lines: string[] = validKey(deps.key) ? [] : [FIRECRAWL_NOT_CONFIGURED];
  const add = (line: string) => { if (!lines.includes(line)) lines.push(line); };
  const problem = (domain: string, failure: string) => problemLines([{ step: 'firecrawl', target: domain, failure }]).forEach(add);
  return {
    pagesUsed: () => used,
    lines: () => [...lines],
    async readTeam(domain: string, pages: string[], leftMs: number): Promise<FirecrawlTeam | null> {
      if (!validKey(deps.key)) { add(FIRECRAWL_NOT_CONFIGURED); return null; }
      if (attempted) return null;
      const url = chooseFirecrawlPage(domain, pages);
      const timeoutMs = firecrawlTimeoutFor(leftMs);
      if (!url) { add('Firecrawl was skipped because no confirmed public company domain was available.'); return null; }
      if (timeoutMs === null) { add('Firecrawl was skipped to leave time for the remaining checks.'); return null; }
      attempted = true;
      const deadline = Date.now() + leftMs;
      // Checkpoints throw cancellation/permission errors to the runner rather than hiding them as provider errors.
      await deps.checkpoint?.();
      let allowed: boolean;
      try { allowed = await deps.reserve(); } catch { problem(domain, 'limit_check'); return null; }
      if (!allowed) { add('Firecrawl was skipped: the daily limit for this organisation was reached.'); return null; }
      await deps.checkpoint?.();
      const currentTimeout = firecrawlTimeoutFor(deadline - Date.now());
      if (currentTimeout === null) { add('Firecrawl was skipped to leave time for the remaining checks.'); return null; }
      const signal = AbortSignal.timeout(currentTimeout);
      try {
        used += 1;
        const response = await request(`${API}/scrape`, { method: 'POST', redirect: 'error', signal,
          headers: { Authorization: `Bearer ${deps.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, formats: ['rawHtml'], onlyMainContent: false, timeout: currentTimeout - 1000, skipTlsVerification: false, parsers: [] }),
        });
        if (!response.ok) { await cancelBody(response); problem(domain, String(response.status)); return null; }
        if (Number(response.headers.get('content-length')) > FIRECRAWL_MAX_BYTES) {
          await cancelBody(response); problem(domain, 'bad_reply'); return null;
        }
        const text = await readCapped(response, signal, FIRECRAWL_MAX_BYTES);
        if (signal.aborted) { problem(domain, 'timeout'); return null; }
        let payload: unknown;
        try { payload = JSON.parse(text); } catch { problem(domain, 'bad_reply'); return null; }
        const result = parseFirecrawlReply(payload, domain);
        if (!result) { problem(domain, 'bad_reply'); return null; }
        add(`Read one company page with Firecrawl: found ${result.people.length} people with roles.`);
        return result;
      } catch { problem(domain, signal.aborted ? 'timeout' : 'network'); return null; }
    },
  };
}
