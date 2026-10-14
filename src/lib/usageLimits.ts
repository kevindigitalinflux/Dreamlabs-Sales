import type { UsageResource } from '../../supabase/functions/_shared/usageRules';

/**
 * The slice of the Supabase client this needs. Saving is an UPDATE, then an INSERT only when no row existed: an
 * `upsert` makes PostgREST write every column in `ON CONFLICT DO UPDATE SET`, and Postgres then demands UPDATE rights
 * on org_id and resource too, which are deliberately not granted (only daily_limit is writable).
 */
export interface LimitsClient {
  from(table: 'usage_limits'): {
    update(values: { daily_limit: number }): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          select(columns?: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
    };
    insert(values: { org_id: string; resource: UsageResource; daily_limit: number }): PromiseLike<{ error: { message: string } | null }>;
  };
}

export async function saveUsageLimit(client: LimitsClient, orgId: string, resource: UsageResource, value: number): Promise<{ ok: boolean }> {
  const table = client.from('usage_limits');
  const updated = await table.update({ daily_limit: value }).eq('org_id', orgId).eq('resource', resource).select('resource');
  if (updated.error) {
    console.error('usage limit update failed:', updated.error.message);
    return { ok: false };
  }
  if ((updated.data?.length ?? 0) > 0) return { ok: true };
  const inserted = await table.insert({ org_id: orgId, resource, daily_limit: value });
  if (inserted.error) {
    console.error('usage limit insert failed:', inserted.error.message);
    return { ok: false };
  }
  return { ok: true };
}
