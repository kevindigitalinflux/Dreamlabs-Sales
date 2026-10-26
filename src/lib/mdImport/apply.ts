import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportFile, ImportedTemplate } from './types';
import type { IcpInput } from '../../hooks/useIcps';
import { matchProfile, matchTemplate } from './matching';
import { checkedRows, loadImportSnapshot } from './store';
export interface ApplyResult { saved: string[]; skipped: string[]; notSaved: string[]; error: string | null }
export interface ApplyOptions { orgId: string; userId: string; isAdmin: boolean }
/** Applies selected items, stopping on the first refused write. */
export async function applyImport(client: SupabaseClient, files: ImportFile[], options: ApplyOptions): Promise<ApplyResult> {
  const result: ApplyResult = { saved: [], skipped: [], notSaved: [], error: null };
  const { orgId, userId, isAdmin } = options;
  if (!isAdmin || !orgId || !userId) return { ...result, error: 'Only an org admin can import setup files.' };
  if (!files.length || files.some((f) => f.parsed.errors.length || !f.parsed.type)) return { ...result, error: 'Remove files with errors before importing.' };
  const contexts = files.filter((f) => f.parsed.type === 'company-context' && f.selected[0]);
  if (contexts.length > 1) return { ...result, error: 'Choose only one company context file.' };
  const profiles: { value: IcpInput; replace: boolean; label: string }[] = [];
  const templates: { value: ImportedTemplate; replace: boolean; label: string }[] = [];
  for (const f of files) {
    if (f.parsed.type === 'icp-profiles') f.parsed.data.forEach((value, i) => { if (f.selected[i]) profiles.push({ value, replace: f.replace, label: `Profile: ${value.name}` }); });
    if (f.parsed.type === 'email-templates') f.parsed.data.forEach((value, i) => { if (f.selected[i]) templates.push({ value, replace: f.replace, label: `Template: ${value.name}` }); });
  }
  result.notSaved = [...contexts.map(() => 'Company context'), ...profiles.map((p) => p.label), ...templates.map((t) => t.label)];
  function done(label: string, message: string, skip = false) {
    result.notSaved.splice(result.notSaved.indexOf(label), 1);
    (skip ? result.skipped : result.saved).push(message);
  }
  try {
    const snapshot = await loadImportSnapshot(client, orgId);
    for (const f of contexts) {
      if (f.parsed.type !== 'company-context') continue;
      const context = f.append && snapshot.context ? `${snapshot.context}\n\n${f.parsed.data}` : f.parsed.data;
      if (context.length > 8000) throw new Error('Combined company context exceeds 8,000 characters. Choose Replace or shorten the file.');
      checkedRows(await client.from('organizations').update({ company_context: context }).eq('id', orgId).select('id'), 1);
      done('Company context', 'Updated company context');
    }
    const newProfiles: { row: Record<string, unknown>; label: string }[] = [];
    const profileUpdates: { id: string; row: Record<string, unknown>; label: string }[] = [];
    const knownProfiles = [...snapshot.profiles];
    for (const p of profiles) {
      const existing = matchProfile(p.value.name, knownProfiles);
      if (existing && (!p.replace || existing.id === 'pending')) { done(p.label, p.label, true); continue; }
      const row = Object.fromEntries(Object.entries(p.value).map(([k, v]) => [k, v.trim() || null]));
      if (existing) profileUpdates.push({ id: existing.id, row, label: p.label });
      else { newProfiles.push({ row: { ...row, org_id: orgId, created_by: userId }, label: p.label }); knownProfiles.push({ id: 'pending', name: p.value.name }); }
    }
    if (newProfiles.length) {
      const rows = checkedRows(await client.from('ideal_customer_profiles').insert(newProfiles.map((p) => p.row)).select('id,name'), newProfiles.length);
      for (const row of rows) snapshot.profiles.push({ id: String(row.id), name: String(row.name) });
      for (const p of newProfiles) done(p.label, `Created ${p.label}`);
    }
    for (const p of profileUpdates) {
      checkedRows(await client.from('ideal_customer_profiles').update(p.row).eq('org_id', orgId).eq('id', p.id).select('id'), 1);
      done(p.label, `Updated ${p.label}`);
    }
    const newTemplates: { row: Record<string, unknown>; label: string }[] = [];
    const templateUpdates: { id: string; row: Record<string, unknown>; label: string }[] = [];
    for (const t of templates) {
      const icp_id = t.value.icp ? matchProfile(t.value.icp, snapshot.profiles)?.id ?? null : null;
      const existing = matchTemplate(t.value.name, icp_id, snapshot.templates);
      if (existing && (!t.replace || existing.id === 'pending')) { done(t.label, t.label, true); continue; }
      const { subject, body, category, links } = t.value;
      const row = { subject, body, category, links, icp_id };
      if (existing) templateUpdates.push({ id: existing.id, row, label: t.label });
      else {
        newTemplates.push({ row: { ...row, name: t.value.name, org_id: orgId, created_by: userId, template_type: 'custom', is_default: false }, label: t.label });
        snapshot.templates.push({ id: 'pending', name: t.value.name, icp_id });
      }
    }
    if (newTemplates.length) {
      checkedRows(await client.from('email_templates').insert(newTemplates.map((t) => t.row)).select('id'), newTemplates.length);
      for (const t of newTemplates) done(t.label, `Created ${t.label}`);
    }
    for (const t of templateUpdates) {
      checkedRows(await client.from('email_templates').update(t.row).eq('org_id', orgId).eq('id', t.id).select('id'), 1);
      done(t.label, `Updated ${t.label}`);
    }
  } catch (error) {
    console.error('Setup import stopped', { orgId, error });
    result.error = error instanceof Error ? error.message : 'Import stopped. Reopen the import to try again.';
  }
  return result;
}
