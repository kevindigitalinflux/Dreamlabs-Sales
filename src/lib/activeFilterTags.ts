import { NO_PROFILE, type LeadFilters } from './leadFilters';
import { stageInfo } from './utils';

export interface FilterTag { key: string; label: string; remove: (filters: LeadFilters) => LeadFilters }

interface Names { assignee: (id: string) => string; icp: (id: string) => string }

const READINESS_LABEL = { ready: 'Ready', almost: 'Almost', needs_work: 'Needs work', not_checked: 'Not checked' } as const;

/** One removable tag per active filter (the search box is not a tag). Removing a tag returns the filters without it. */
export function activeFilterTags(filters: LeadFilters, names: Names): FilterTag[] {
  const tags: FilterTag[] = [];
  for (const stage of filters.stages) tags.push({ key: `stage:${stage}`, label: stageInfo(stage).label, remove: (f) => ({ ...f, stages: f.stages.filter((s) => s !== stage) }) });
  for (const id of filters.assignees) tags.push({ key: `assignee:${id}`, label: names.assignee(id), remove: (f) => ({ ...f, assignees: f.assignees.filter((a) => a !== id) }) });
  for (const id of filters.icps ?? []) tags.push({ key: `icp:${id}`, label: id === NO_PROFILE ? 'No profile' : names.icp(id), remove: (f) => ({ ...f, icps: (f.icps ?? []).filter((i) => i !== id) }) });
  for (const value of filters.readiness ?? []) tags.push({ key: `readiness:${value}`, label: READINESS_LABEL[value], remove: (f) => ({ ...f, readiness: (f.readiness ?? []).filter((r) => r !== value) }) });
  if (filters.overdueOnly) tags.push({ key: 'overdue', label: 'Overdue only', remove: (f) => ({ ...f, overdueOnly: false }) });
  if (filters.hasPhone) tags.push({ key: 'hasPhone', label: 'Has phone', remove: (f) => ({ ...f, hasPhone: false }) });
  if (filters.hasDirectLine) tags.push({ key: 'hasDirectLine', label: 'Has direct line', remove: (f) => ({ ...f, hasDirectLine: false }) });
  if (filters.needsLookOnly) tags.push({ key: 'needsLook', label: 'Needs a look', remove: (f) => ({ ...f, needsLookOnly: false }) });
  return tags;
}
