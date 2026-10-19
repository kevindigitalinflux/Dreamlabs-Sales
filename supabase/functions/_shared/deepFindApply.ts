import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { AutoApplied } from './deepFindAutoApply.ts';

/** One authorized blank fill and its Undo record. Exact old-value filters protect concurrent edits. */
export async function applyDeepFindBlank(
  service: SupabaseClient, scope: { leadId: string; orgId: string },
  table: AutoApplied['table'], row: Record<string, unknown> & { id: string }, field: string, after: string,
  changes: AutoApplied[], checkpoint: () => Promise<void>,
): Promise<boolean> {
  const allowed = table === 'leads' ? ['website', 'phone', 'owner_name'] : ['email', 'title', 'linkedin_url'];
  if (!allowed.includes(field) || !after.trim() || (typeof row[field] === 'string' && row[field].trim())) return false;
  if (row[field] !== null && row[field] !== undefined && typeof row[field] !== 'string') return false;
  if (table === 'decision_maker_candidates' && row.dismissed_at) return false;
  const before = typeof row[field] === 'string' ? row[field] as string : null;
  await checkpoint();
  let query = service.from(table).update({ [field]: after, updated_at: new Date().toISOString(),
    ...(table === 'decision_maker_candidates' && field === 'email' ? { include_in_sequences: false } : {}),
  }).eq('id', row.id);
  query = table === 'leads' ? query.eq('org_id', scope.orgId).eq('id', scope.leadId)
    : query.eq('lead_id', scope.leadId).is('dismissed_at', null);
  query = before === null ? query.is(field, null) : query.eq(field, before);
  const { data, error } = await query.select('id');
  if (error) { console.error('deep find: automatic blank fill failed'); return false; }
  if (!data?.length) return false;
  row[field] = after;
  if (table === 'decision_maker_candidates' && field === 'email') row.include_in_sequences = false;
  changes.push({ table, id: row.id, field, before, after });
  return true;
}
