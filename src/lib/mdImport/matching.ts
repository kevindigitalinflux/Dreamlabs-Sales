import type { EmailTemplate } from '../../types';
import type { NamedProfile, NamedTemplate } from './types';

/** Finds a profile by the database's case-insensitive name rule. */
export function matchProfile(name: string, profiles: NamedProfile[]) { return profiles.find((p) => p.name.toLowerCase() === name.toLowerCase()); }
/** Resolves an existing or selected batch profile without inventing an id. */
export function resolveProfile(name: string | null, profiles: NamedProfile[], pending: string[]): string | null {
  if (!name) return null;
  return matchProfile(name, profiles)?.id ?? (pending.some((n) => n.toLowerCase() === name.toLowerCase()) ? 'pending' : 'unresolved');
}
/** Finds an existing template only within the given ICP. */
export function matchTemplate(name: string, icpId: string | null, templates: NamedTemplate[]): NamedTemplate | undefined {
  return templates.find((t) => t.name.toLowerCase() === name.toLowerCase() && t.icp_id === icpId);
}
/** Prepares org-owned copies and collision-free names, retaining stored file references. */
export function copyTemplateRows(sources: EmailTemplate[], existing: NamedTemplate[], orgId: string, userId: string, target?: NamedProfile) {
  const used = [...existing];
  return sources.map((source) => {
    const icp_id = target ? target.id : source.icp_id;
    const base = target ? `${source.name} — ${target.name}` : `Copy of ${source.name}`;
    let name = base, suffix = 2;
    while (matchTemplate(name, icp_id, used)) name = `${base} (${suffix++})`;
    used.push({ id: '', name, icp_id });
    return { name, subject: source.subject, body: source.body, category: source.category, icp_id,
      links: source.links ?? [], attachments: source.attachments ?? [], is_default: false,
      template_type: 'custom' as const, org_id: orgId, created_by: userId };
  });
}
