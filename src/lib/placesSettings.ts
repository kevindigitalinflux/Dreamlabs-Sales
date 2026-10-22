export interface PlacesSnapshot { used: number; limit: number; resets_at: string }

/** An absent migration or malformed snapshot leaves the meter unavailable. */
export function parsePlacesSnapshot(value: unknown): PlacesSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as PlacesSnapshot;
  return Number.isInteger(r.used) && r.used >= 0 && Number.isInteger(r.limit) && r.limit >= 0 && r.limit <= 100000
    && typeof r.resets_at === 'string' && Number.isFinite(Date.parse(r.resets_at)) ? r : null;
}

interface PlacesLimitsClient {
  from(table: 'places_usage_limits'): {
    update(value: { monthly_limit: number }): { eq(column: string, value: string): { select(column: string): PromiseLike<{ data: unknown[] | null; error: unknown }> } };
    insert(value: { org_id: string; monthly_limit: number }): PromiseLike<{ error: unknown }>;
  };
}

/** Column-limited UPDATE, then INSERT: an upsert would require key-column UPDATE grants. */
export async function savePlacesLimit(client: PlacesLimitsClient, orgId: string, value: number): Promise<boolean> {
  if (!Number.isInteger(value) || value < 0 || value > 100000) return false;
  try {
    const table = client.from('places_usage_limits');
    const result = await table.update({ monthly_limit: value }).eq('org_id', orgId).select('org_id');
    if (result.error) return false;
    if (result.data?.length) return true;
    return !(await table.insert({ org_id: orgId, monthly_limit: value })).error;
  } catch { console.error('Google Places limit could not be saved'); return false; }
}
