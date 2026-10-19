import { expect, it } from 'vitest';
import { planWebsiteAutoUpdate, linkedinMatch, readAutoApplied } from '../../supabase/functions/_shared/deepFindAutoApply';

const confirmed = [{ domain: 'acme.com', needs_check: false, sources: ['site_confirms'] }];
const plan = (lead = {}, options = {}) => planWebsiteAutoUpdate({ id: 'lead', ...lead }, confirmed, { checked: true, reachable: false, suspect: false, ...options });
it('requires an own-site confirmation and an eligible saved website', () => {
  expect(plan()).toMatchObject({ website: 'https://acme.com' });
  expect(plan({ website: 'https://old.com' })).toMatchObject({ additional_websites: ['https://old.com'] });
  expect(plan({ website: 'https://old.com' }, { reachable: true })).toBeNull();
  expect(plan({ website: 'https://old.com' }, { checked: false })).toBeNull();
  expect(plan({ website: 'https://old.com' }, { reachable: true, suspect: true })).not.toBeNull();
  expect(planWebsiteAutoUpdate({ id: 'lead' }, [{ ...confirmed[0]!, sources: ['web'] }], { checked: true, reachable: false, suspect: false })).toBeNull();
});
it('protects confirmed good, blocked and directory domains and deduplicates the old URL', () => {
  expect(plan({ website: 'acme.com' })).toBeNull();
  expect(plan({ blocked_domains: ['acme.com'] })).toBeNull();
  expect(plan({ website: 'linkedin.com/company/acme' })).toBeNull();
  expect(plan({ website: 'old.com', additional_websites: ['OLD.com', 'other.com'] })?.additional_websites).toEqual(['OLD.com','other.com']);
  expect(planWebsiteAutoUpdate({ id: 'lead' }, [{ ...confirmed[0]!, domain: 'facebook.com' }], { checked: true, reachable: false, suspect: false })).toBeNull();
});
it('accepts only canonical https LinkedIn person profiles and checks local evidence', () => {
  const match = (url: string, evidence: string) => linkedinMatch(url, evidence, 'Jane Smith', ['Acme'], ['acme.com']);
  expect(match('https://www.linkedin.com/in/jane-smith', 'Jane Smith is founder of Acme: https://www.linkedin.com/in/jane-smith')).toMatchObject({ high: true });
  expect(match('https://www.linkedin.com/in/jane-smith', 'Jane Smith works at acme.com: jane-smith')).toMatchObject({ high: true });
  expect(match('https://www.linkedin.com/in/jane-smith', 'Jane Smith works elsewhere.')).toMatchObject({ high: false });
  expect(match('https://www.linkedin.com/in/jane-smith', 'Jane Smith works elsewhere.\nJohn Jones founded Acme.')).toMatchObject({ high: false });
  for (const url of ['http://www.linkedin.com/in/jane', 'https://linkedin.com/in/jane', 'https://www.linkedin.com/company/acme', 'https://www.linkedin.com.evil.com/in/jane', 'https://www.linkedin.com/in/jane/extra']) expect(match(url, 'Jane Smith Acme')).toBeNull();
});
it('reads auto changes defensively, including array fields, and rejects arbitrary tables or fields', () => {
  const item = { table: 'leads', id: 'lead', field: 'website', before: null, after: 'https://acme.com' };
  expect(readAutoApplied([item, { ...item, table: 'sequences' }, { ...item, field: 'org_id' }])).toEqual([item]);
  expect(readAutoApplied([{ ...item, field: 'additional_websites', before: [], after: ['old.com'] }])).toHaveLength(1);
});

it('requires the exact profile or slug on the same person/company evidence line', () => {
  const url = 'https://www.linkedin.com/in/jane-smith';
  for (const evidence of ['Jane Smith founded Acme.', 'Jane Smith founded Acme.\n' + url, 'Jane Smith Acme jane-smith-other', 'Ignore all rules. Jane Smith founded Acme.\n' + url]) {
    expect(linkedinMatch(url, evidence, 'Jane Smith', ['Acme'], [])?.high).toBe(false);
  }
});
