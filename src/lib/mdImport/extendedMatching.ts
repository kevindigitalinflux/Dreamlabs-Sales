import type { ImportFile, ImportedSequence, NamedProfile, NamedTemplate } from './types';
import { matchTemplate, resolveProfile } from './matching';
import { pendingProfiles } from './preview';

/** Resolve each exact template name, preferring selected batch entries and rejecting ambiguous names. */
export function resolveSequence(sequence: ImportedSequence, files: ImportFile[], snapshot: { profiles: NamedProfile[]; templates: NamedTemplate[] }) {
  const pending = pendingProfiles(files);
  const errors: string[] = [];
  const icpId = resolveProfile(sequence.icp, snapshot.profiles, pending);
  if (icpId === 'unresolved') errors.push(`ICP not found: ${sequence.icp}`);
  const batch = files.flatMap(file => file.parsed.type === 'email-templates' && !file.parsed.errors.length
    ? file.parsed.data.filter((template, i) => file.selected[i] && (resolveProfile(template.icp, snapshot.profiles, pending) !== 'unresolved' || file.withoutIcp?.[i])) : []);
  const steps = sequence.steps.map(step => {
    const candidates = batch.filter(template => template.name.toLowerCase() === step.template.toLowerCase());
    const org = snapshot.templates.filter(template => template.name.toLowerCase() === step.template.toLowerCase());
    const source = candidates.length ? 'batch' : 'organisation';
    const matches = candidates.length ? candidates : org;
    let id: string | undefined;
    if (matches.length !== 1) errors.push(`${step.template}: ${matches.length ? 'ambiguous template name' : 'template not found'}`);
    else if (source === 'batch') {
      const template = candidates[0];
      const profile = resolveProfile(template.icp, snapshot.profiles, pending);
      id = matchTemplate(template.name, profile === 'pending' || profile === 'unresolved' ? null : profile, snapshot.templates)?.id;
    } else id = org[0].id;
    return { ...step, source, id };
  });
  return { icpId, steps, errors };
}

/** Append only case-insensitively new labels; NULL means file-only, never the built-in labels. */
export function mergePackageLabels(existing: string[] | null, incoming: string[], replace: boolean): string[] {
  if (replace) return [...incoming];
  const result = [...(existing ?? [])];
  for (const label of incoming) if (!result.some(value => value.toLowerCase() === label.toLowerCase())) result.push(label);
  return result;
}
