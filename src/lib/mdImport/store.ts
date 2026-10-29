import type { SupabaseClient } from '@supabase/supabase-js';
import type { NamedProfile, NamedTemplate } from './types';

export interface ImportSnapshot { context: string; profiles: NamedProfile[]; templates: NamedTemplate[]; customKeys: string[];
  packages?: string[] | null; sequences?: { id: string; name: string; steps?: unknown; icp_id?: string | null; is_active?: boolean }[] }

/** Reads only the selected org's replacement candidates, never global templates. */
export async function loadImportSnapshot(client: SupabaseClient, orgId: string, extended = false): Promise<ImportSnapshot> {
  const results = await Promise.all([
    client.from('organizations').select('id,company_context,custom_packages').eq('id', orgId),
    client.from('ideal_customer_profiles').select('id,name').eq('org_id', orgId),
    client.from('email_templates').select('id,name,icp_id').eq('org_id', orgId),
    ...(extended ? [client.from('email_sequences').select('id,name,steps,icp_id,is_active').eq('org_id', orgId)] : []),
  ]);
  for (const result of results) if (result.error) throw new Error(result.error.message);
  if (results[0].data?.length !== 1) throw new Error('Company details could not be read. Reopen the import.');
  return { context: results[0].data[0].company_context ?? '', profiles: results[1].data ?? [], templates: results[2].data ?? [], customKeys: [],
    packages: results[0].data[0].custom_packages ?? null, sequences: results[3]?.data ?? [] };
}

/** Detects errors and silent RLS denials by requiring the returned row count. */
export function checkedRows(result: { data: unknown; error: { message: string } | null }, count: number): Record<string, unknown>[] {
  if (result.error) throw new Error(result.error.message);
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  if (rows.length !== count) throw new Error('The changes were not saved. Check your permission and reopen the import.');
  return rows;
}
