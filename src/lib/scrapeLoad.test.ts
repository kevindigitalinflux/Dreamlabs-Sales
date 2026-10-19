import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ responses: [] as Array<{ data: unknown; error: unknown }>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }> }));
vi.mock('./supabase', () => ({ supabase: { from: (table: string) => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'in', 'order', 'single', 'range']) {
    query[method] = (...args: unknown[]) => { fake.calls.push({ table, method, args }); return query; };
  }
  query.then = (resolve: (r: unknown) => unknown) => resolve(fake.responses.shift());
  return query;
} } }));
import { loadScrapeSearch } from '../hooks/useScrapeJob';

describe('durable grouped scrape reads', () => {
  it('discovers both sources from the saved anchor and scopes group lookup to org and creator', async () => {
    fake.calls = [];
    const group = { id: '12345678-1234-4234-8234-123456789abc', sources: ['google_places', 'companies_house'] };
    const job = { id: 'a', org_id: 'org', created_by: 'user', icp_params: { scrape_group: group } };
    fake.responses = [{ data: job, error: null }, { data: [job, { ...job, id: 'b' }], error: null },
      { data: Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })), error: null }, { data: [{ id: 'last' }], error: null }];
    const result = await loadScrapeSearch('a');
    expect(result.jobs.map((j) => j.id)).toEqual(['a', 'b']);
    expect(result.rawLeads).toHaveLength(1001);
    expect(fake.calls).toContainEqual({ table: 'scrape_jobs', method: 'eq', args: ['org_id', 'org'] });
    expect(fake.calls).toContainEqual({ table: 'scrape_jobs', method: 'eq', args: ['created_by', 'user'] });
    expect(fake.calls).toContainEqual({ table: 'scrape_jobs', method: 'eq', args: ['icp_params->scrape_group->>id', group.id] });
    expect(fake.calls).toContainEqual({ table: 'raw_leads', method: 'in', args: ['scrape_job_id', ['a', 'b']] });
    expect(fake.calls).toContainEqual({ table: 'raw_leads', method: 'range', args: [1000, 1999] });
  });
  it('keeps legacy jobs single and refuses a partial result read instead of allowing incomplete approval', async () => {
    fake.calls = [];
    fake.responses = [{ data: { id: 'old', icp_params: {} }, error: null }, { data: [], error: { code: 'denied' } }];
    await expect(loadScrapeSearch('old')).rejects.toEqual({ code: 'denied' });
    expect(fake.calls.filter((c) => c.table === 'scrape_jobs' && c.method === 'select')).toHaveLength(1);
  });
});
