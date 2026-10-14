// supabase/functions/_shared/usage.ts
// Edge-function side of the worker usage limits. Reserve BEFORE calling the worker; refund (with the day the reserve
// returned) when the call did no work (worker unreachable, busy or not configured). A cache hit never reserves.
// Fails closed: an error here means "not allowed", so a broken check can never lift a cap.
import { parseReserve, type ReserveResult, type UsageResource } from './usageRules.ts';

/** The slice of a Supabase client these helpers need (a real SupabaseClient satisfies it). */
export interface UsageClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function reserveUsage(service: UsageClient, orgId: string, resource: UsageResource, units = 1): Promise<ReserveResult> {
  try {
    const { data, error } = await service.rpc('usage_reserve', { p_org: orgId, p_resource: resource, p_units: units });
    if (error) {
      console.error('usage_reserve failed:', error.message);
      return { ok: false, reason: 'error' };
    }
    return parseReserve(data);
  } catch (err) {
    console.error('usage_reserve threw:', err instanceof Error ? err.message : 'unknown');
    return { ok: false, reason: 'error' };
  }
}

/** Best effort: returns whether the units were given back. Never throws. */
export async function refundUsage(service: UsageClient, orgId: string, resource: UsageResource, units: number, day: string): Promise<boolean> {
  try {
    const { data, error } = await service.rpc('usage_refund', { p_org: orgId, p_resource: resource, p_units: units, p_day: day });
    if (error) {
      console.error('usage_refund failed:', error.message);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error('usage_refund threw:', err instanceof Error ? err.message : 'unknown');
    return false;
  }
}
