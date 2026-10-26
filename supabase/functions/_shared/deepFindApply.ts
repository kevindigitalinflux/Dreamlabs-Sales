import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { AutoApplied } from './deepFindAutoApply.ts';
import { isReviewPhone, isSuggestionDismissed, registrySkipReason } from './deepFindSuggestions.ts';
import type { BusinessPhone } from './phoneNumbers.ts';

/** One authorized blank fill and its Undo record. Exact old-value filters protect concurrent edits. */
export async function applyDeepFindBlank(
  service: SupabaseClient, scope: { leadId: string; orgId: string },
  table: AutoApplied['table'], row: Record<string, unknown> & { id: string }, field: string, after: string,
  changes: AutoApplied[], checkpoint: () => Promise<void>, phone?: BusinessPhone,
): Promise<boolean> {
  const allowed = table === 'leads' ? ['website', 'phone', 'owner_name', 'company_number'] : ['email', 'title', 'linkedin_url'];
  if (!allowed.includes(field) || !after.trim() || (typeof row[field] === 'string' && row[field].trim())) return false;
  if (changes.length >= 100 || (field === 'phone' && !isReviewPhone(after))) return false;
  if (row[field] !== null && row[field] !== undefined && typeof row[field] !== 'string') return false;
  if (table === 'decision_maker_candidates' && row.dismissed_at) return false;
  const before = typeof row[field] === 'string' ? row[field] as string : null;
  await checkpoint();
  const { data: lead, error: readError } = await service.from('leads').select('dismissed_suggestions, country, registry_candidates_rejected, phone_meta')
    .eq('id', scope.leadId).eq('org_id', scope.orgId).maybeSingle();
  if (readError || !lead) return false;
  if (field === 'company_number' && registrySkipReason(lead)) return false;
  const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim();
  if (isSuggestionDismissed({ name, field, value: after }, lead)) return false;
  const previousMeta = lead.phone_meta ?? {};
  const nextMeta = phone && field === 'phone' ? { ...previousMeta, [phone.value]: phone } : null;
  if (phone && field === 'phone') after = phone.value;
  let query = service.from(table).update({ [field]: after, updated_at: new Date().toISOString(),
    ...(nextMeta ? { phone_meta: nextMeta } : {}),
    ...(table === 'decision_maker_candidates' && field === 'email' ? { include_in_sequences: false } : {}),
  }).eq('id', row.id);
  query = table === 'leads' ? query.eq('org_id', scope.orgId).eq('id', scope.leadId)
    : query.eq('lead_id', scope.leadId).is('dismissed_at', null);
  query = before === null ? query.is(field, null) : query.eq(field, before);
  if (nextMeta && lead.phone_meta !== undefined) query = query.eq('phone_meta', previousMeta);
  const { data, error } = await query.select('id');
  if (error) { console.error('deep find: automatic blank fill failed'); return false; }
  if (!data?.length) return false;
  row[field] = after;
  if (nextMeta) row.phone_meta = nextMeta;
  if (table === 'decision_maker_candidates' && field === 'email') row.include_in_sequences = false;
  changes.push({ table, id: row.id, field, before, after });
  return true;
}
