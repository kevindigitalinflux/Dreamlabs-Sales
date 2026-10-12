import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Simple database-backed rate limit: allows at most `maxRequests` for a given
 * `rateKey` within `windowMinutes`. Logs this request as a side effect
 * whenever it's allowed (never logs a request that's already over the
 * limit, so a sustained flood doesn't grow the log unboundedly beyond the
 * window). Returns true if the request should be allowed.
 *
 * `failClosed` (default false, which keeps the original behaviour for existing callers such as `unsubscribe`):
 * when true, a failed count or a failed log insert counts as "limited", so a database problem can never lift a cost
 * bound (Deep find, the known-person lookup).
 */
export async function checkRateLimit(
  // deno-lint-ignore no-explicit-any
  service: SupabaseClient<any>, rateKey: string, maxRequests: number, windowMinutes: number, failClosed = false,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await service.from('rate_limit_log')
    .select('id', { count: 'exact', head: true })
    .eq('rate_key', rateKey).gte('created_at', since);
  if (failClosed && (error || count === null || count === undefined)) return false;
  if ((count ?? 0) >= maxRequests) return false;
  const { error: insertErr } = await service.from('rate_limit_log').insert({ rate_key: rateKey });
  if (failClosed && insertErr) return false;
  return true;
}
