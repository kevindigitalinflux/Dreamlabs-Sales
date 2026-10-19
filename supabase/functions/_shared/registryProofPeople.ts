import { cancelBody, readCapped } from './cappedBody.ts';
import { cleanCompanyNumber } from './registrySearch.ts';

/** Active individual PSCs only, one free request; body read shares the request's five-second deadline. */
export async function fetchActivePscNames(number: string, key: string): Promise<string[]> {
  if (!cleanCompanyNumber(number)) return [];
  try {
    const signal = AbortSignal.timeout(5000);
    const response = await fetch(`https://api.company-information.service.gov.uk/company/${number}/persons-with-significant-control?items_per_page=25`, {
      signal, redirect: 'error', headers: { Authorization: 'Basic ' + btoa(`${key}:`) },
    });
    if (!response.ok) { await cancelBody(response); return []; }
    const payload = JSON.parse(await readCapped(response, signal, 200_000)) as { items?: unknown };
    if (!Array.isArray(payload.items)) return [];
    return payload.items.slice(0, 25).flatMap((raw: unknown) => {
      if (!raw || typeof raw !== 'object') return [];
      const p = raw as Record<string, unknown>;
      return p.kind === 'individual-person-with-significant-control' && !p.ceased_on && typeof p.name === 'string'
        && p.name.length <= 160 ? [p.name] : [];
    });
  } catch { console.error('deep find: registry PSC evidence unavailable'); return []; }
}
