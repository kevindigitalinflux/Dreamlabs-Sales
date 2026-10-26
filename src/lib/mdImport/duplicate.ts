import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailTemplate } from '../../types';
import type { NamedProfile } from './types';
import { copyTemplateRows } from './matching';
import { checkedRows } from './store';
/** Creates copies and returns saved records for opening the editor. */
export async function duplicateTemplates(client: SupabaseClient, sources: EmailTemplate[], orgId: string, userId: string, target?: NamedProfile): Promise<EmailTemplate[]> {
  if (!orgId || !userId) throw new Error('Sign in and choose an organization before copying templates.');
  if (!sources.length) throw new Error('Choose at least one template.');
  const existing = await client.from('email_templates').select('id,name,icp_id').or(`org_id.is.null,org_id.eq.${orgId}`);
  if (existing.error) throw new Error(existing.error.message);
  const rows = copyTemplateRows(sources, existing.data ?? [], orgId, userId, target);
  const result = await client.from('email_templates').insert(rows).select('*');
  return checkedRows(result, rows.length) as unknown as EmailTemplate[];
}
