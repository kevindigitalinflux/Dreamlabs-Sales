import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Simple database-backed rate limit: allows at most `maxRequests` for a given
 * `rateKey` within `windowMinutes`. Logs this request as a side effect
 * whenever it's allowed (never logs a request that's already over the
 * limit, so a sustained flood doesn't grow the log unboundedly beyond the
 * window). Returns true if the request should be allowed.
 */
export async function checkRateLimit(
  // deno-lint-ignore no-explicit-any
  service: SupabaseClient<any>, rateKey: string, maxRequests: number, windowMinutes: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count } = await service.from('rate_limit_log')
    .select('id', { count: 'exact', head: true })
    .eq('rate_key', rateKey).gte('created_at', since);
  if ((count ?? 0) >= maxRequests) return false;
  await service.from('rate_limit_log').insert({ rate_key: rateKey });
  return true;
}
