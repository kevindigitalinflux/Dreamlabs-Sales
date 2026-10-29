import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportFile } from './types';
import type { ApplyOptions } from './apply';
import { checkedRows, loadImportSnapshot, type ImportSnapshot } from './store';
import { mergePackageLabels, resolveSequence } from './extendedMatching';
type Done = (label: string, message: string, skip?: boolean) => void;
const canonicalSteps = (value: unknown) => Array.isArray(value) ? value.map((item: unknown) => {
  const step = item && typeof item === 'object' ? item as Record<string, unknown> : {};
  return { template_id: step.template_id ?? null, template_type: step.template_type, delay_days: step.delay_days, subject_override: step.subject_override ?? null };
}) : null;

/** Save labels only, through the same organisation column update as CompanyProfileCard. */
export async function applyPackages(client: SupabaseClient, files: ImportFile[], snapshot: ImportSnapshot, orgId: string, done: Done, onChanged?: (labels: string[]) => void) {
  for (const file of files) {
    if (file.parsed.type !== 'company-packages' || !file.selected.some(Boolean)) continue;
    const labels = file.parsed.data.filter((_, i) => file.selected[i]).map(item => item.name);
    const next = mergePackageLabels(snapshot.packages ?? null, labels, file.replace);
    const label = `Packages: ${file.filename}`;
    if (JSON.stringify(next) === JSON.stringify(snapshot.packages)) { done(label, label, true); continue; }
    checkedRows(await client.from('organizations').update({ custom_packages: next }).eq('id', orgId).select('id'), 1);
    snapshot.packages = next; done(label, `Updated ${label}`); onChanged?.(next);
  }
}

/** Each sequence and its steps are saved in one atomic row operation; never enrol or touch unrelated sequences. */
export async function applySequences(client: SupabaseClient, files: ImportFile[], options: ApplyOptions, done: Done) {
  const selected = files.flatMap(file => file.parsed.type === 'sequences' ? file.parsed.data.filter((_, i) => file.selected[i]).map(value => ({ value, replace: file.replace })) : []);
  if (!selected.length) return;
  const snapshot = await loadImportSnapshot(client, options.orgId, true);
  for (const { value, replace } of selected) {
    const label = `Sequence: ${value.name}`;
    const matches = (snapshot.sequences ?? []).filter(sequence => sequence.name.toLowerCase() === value.name.toLowerCase());
    if (matches.length > 1) throw new Error(`Sequence name is ambiguous: ${value.name}`);
    const existing = matches[0];
    if (existing && !replace) { done(label, label, true); continue; }
    const resolved = resolveSequence(value, files, snapshot);
    if (resolved.errors.length || resolved.steps.some(step => !step.id)) throw new Error(resolved.errors.join('; ') || `Templates could not be resolved: ${value.name}`);
    const steps = resolved.steps.map(step => ({ template_id: step.id!, template_type: 'custom', delay_days: step.wait_days, subject_override: null }));
    const row = { steps, icp_id: resolved.icpId };
    if (existing && existing.icp_id === row.icp_id && JSON.stringify(canonicalSteps(existing.steps)) === JSON.stringify(canonicalSteps(steps))) { done(label, label, true); continue; }
    const query = existing ? client.from('email_sequences').update(row).eq('org_id', options.orgId).eq('id', existing.id)
      : client.from('email_sequences').insert({ ...row, is_active: false, name: value.name, description: null, category: null, is_default: false, auto_draft_on_reply: false, org_id: options.orgId, created_by: options.userId });
    const saved = checkedRows(await query.select('id'), 1)[0];
    if (!existing) snapshot.sequences!.push({ id: String(saved.id), name: value.name, ...row, is_active: false });
    else Object.assign(existing, row);
    done(label, `${existing ? 'Updated' : 'Created'} ${label}`);
  }
}
