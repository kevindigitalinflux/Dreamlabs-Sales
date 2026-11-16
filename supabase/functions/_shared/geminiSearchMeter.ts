export const GEMINI_FREE_SEARCHES_PER_MONTH = 5000;
export interface GeminiMeterClient { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data?: unknown; error?: unknown }> }
export interface GeminiSearchContext { service: GeminiMeterClient; orgId: string; sharedKey: boolean }
export interface GeminiSearchSnapshot { orgSearches: number; sharedKey: boolean; sharedSearches: number | null }

/** Informational counting must never turn a successful lookup into a failure. */
export async function countGeminiSearch(service: GeminiMeterClient, orgId: string, sharedKey: boolean): Promise<void> {
  try {
    const result = await service.rpc('gemini_search_count', { p_org: orgId, p_shared: sharedKey, p_n: 1 });
    if (result.error) console.error('gemini_search_count_failed');
  } catch { console.error('gemini_search_count_failed'); }
}

/** Accept counts only; no organisation rows or identifiers are exposed by the snapshot. */
export function parseGeminiSearchSnapshot(raw: unknown): GeminiSearchSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
  if (!count(item.org_searches) || typeof item.shared_key !== 'boolean' || (item.shared_key && !count(item.shared_searches))) return null;
  return { orgSearches: item.org_searches, sharedKey: item.shared_key, sharedSearches: item.shared_key ? item.shared_searches as number : null };
}

/** Approximate call count, never an admission rule or a claim about Google's internal query count. */
export function geminiSearchPresentation(snapshot: GeminiSearchSnapshot): { state: 'ok' | 'warning' | 'full'; text: string } {
  const count = snapshot.sharedKey ? snapshot.sharedSearches ?? 0 : snapshot.orgSearches;
  return { state: count >= 5000 ? 'full' : count >= 4000 ? 'warning' : 'ok',
    text: `Web searches by Gemini this month: about ${count.toLocaleString('en-GB')} of 5,000 free.${count >= 5000 ? ' Searches beyond this are billed by Google.' : ''}` };
}
