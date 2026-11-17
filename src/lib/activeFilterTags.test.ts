import { describe, expect, it } from 'vitest';
import { activeFilterTags } from './activeFilterTags';
import { NO_PROFILE, type LeadFilters } from './leadFilters';

const NAMES = { assignee: (id: string) => `Person ${id}`, icp: (id: string) => `Profile ${id}` };
const EMPTY: LeadFilters = { search: '', stages: [], assignees: [], overdueOnly: false, icps: [] };

describe('activeFilterTags', () => {
  it('has no tags when nothing is filtered, and the search text is never a tag', () => {
    expect(activeFilterTags({ ...EMPTY, search: 'apex' }, NAMES)).toEqual([]);
  });
  it('makes one tag per active filter with readable labels', () => {
    const tags = activeFilterTags({ ...EMPTY, stages: ['contacted'], assignees: ['a1'], icps: ['p1', NO_PROFILE], readiness: ['almost'], overdueOnly: true, hasPhone: true, hasDirectLine: true, needsLookOnly: true }, NAMES);
    expect(tags.map((t) => t.label)).toEqual(['Contacted', 'Person a1', 'Profile p1', 'No profile', 'Almost', 'Overdue only', 'Has phone', 'Has direct line', 'Needs a look']);
    expect(new Set(tags.map((t) => t.key)).size).toBe(tags.length);
  });
  it('removing a tag clears only that filter', () => {
    const filters: LeadFilters = { ...EMPTY, stages: ['contacted', 'won'], hasPhone: true };
    const tags = activeFilterTags(filters, NAMES);
    const afterStage = tags[0]!.remove(filters);
    expect(afterStage.stages).toEqual(['won']);
    expect(afterStage.hasPhone).toBe(true);
    const afterPhone = tags.find((t) => t.key === 'hasPhone')!.remove(filters);
    expect(afterPhone.hasPhone).toBe(false);
    expect(afterPhone.stages).toEqual(['contacted', 'won']);
  });
});
