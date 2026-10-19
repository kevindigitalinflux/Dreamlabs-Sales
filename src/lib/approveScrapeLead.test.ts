import { describe, expect, it } from 'vitest';
import type { RawLead } from '../types';
import { mergeScrapeLeads } from './scrapeMerge';
import { approveScrapeLead, rejectScrapeLead } from './approveScrapeLead';

const row = (id: string, source: RawLead['source'] = 'google_places'): RawLead => ({ id, source, business_name: 'Acme', city: 'York',
  source_id: source === 'companies_house' ? '12345678' : 'place', raw_data: { officers: [{ first_name: 'Ann' }] },
  website: source === 'google_places' ? 'acme.com' : null, scrape_job_id: 'job', owner_name: null, phone: null,
  email: null, address: null, postcode: null, google_rating: null, review_count: null, vertical: null, status: 'pending',
  duplicate_of: null, approved_by: null, approved_at: null, created_at: '2026-10-19' });

function database(options: { existing?: boolean; statusFails?: boolean; insertFails?: boolean } = {}) {
  const calls: Array<{ table: string; op: string; value: unknown }> = [];
  const db = { from: (table: string) => {
    let op = '', value: unknown, ids = ['saved'];
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'insert', 'update', 'in', 'eq', 'limit']) query[method] = (v: unknown, second: unknown) => {
      if (method === 'in' && v === 'id') ids = second as string[];
      if (['insert', 'update'].includes(method) || (method === 'select' && !op)) { op = method; value = v; calls.push({ table, op, value }); }
      return query;
    };
    query.then = (resolve: (v: unknown) => unknown) => resolve({
      data: table === 'leads' && op === 'select' ? options.existing ? [{ id: 'saved' }] : [] : ids.map((id) => ({ id })),
      error: options.statusFails && table === 'raw_leads' && (value as { status?: string })?.status ? { message: 'Retry status' }
        : options.insertFails && op === 'insert' ? { message: 'Insert failed' } : null,
    });
    return query;
  } };
  return { db, calls };
}

describe('reviewing merged raw rows', () => {
  it('persists merged officer data before insertion and anchors the real registry row FK; marks all members reviewed', async () => {
    const { db, calls } = database();
    const [lead] = mergeScrapeLeads([row('places'), row('registry', 'companies_house')]);
    expect(await approveScrapeLead(db as never, lead, { orgId: 'org', pipelineId: 'pipe', userId: 'user', icpId: 'icp', country: 'GB' })).toBeNull();
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.value).toMatchObject({ raw_lead_id: 'registry', website: 'acme.com', company_number: '12345678', country: 'GB', icp_id: 'icp' });
    expect(calls.findIndex((c) => c.table === 'raw_leads' && c.op === 'update')).toBeLessThan(calls.indexOf(insert!));
    expect(calls.at(-1)?.value).toMatchObject({ status: 'approved' });
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });
  it('retry after a successful insert reuses the existing FK without inserting a second lead', async () => {
    const { db, calls } = database({ existing: true });
    expect(await approveScrapeLead(db as never, row('p'), { orgId: 'org', pipelineId: 'pipe' })).toBeNull();
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });
  it('does not mark sources approved if insertion failed, and reports partial status failures', async () => {
    const failed = database({ insertFails: true });
    expect(await approveScrapeLead(failed.db as never, row('p'), { orgId: 'org', pipelineId: 'pipe' })).toBe('Insert failed');
    expect(failed.calls.some((c) => (c.value as { status?: string })?.status === 'approved')).toBe(false);
    const status = database({ statusFails: true });
    expect(await approveScrapeLead(status.db as never, row('p'), { orgId: 'org', pipelineId: 'pipe' })).toBe('Retry status');
  });
  it('refuses missing pipeline and rejects all merged members without inserting a lead', async () => {
    const { db, calls } = database();
    expect(await approveScrapeLead(db as never, row('p'), { orgId: 'org' })).toMatch(/pipeline/);
    const lead = mergeScrapeLeads([row('p'), row('r', 'companies_house')])[0];
    expect(await rejectScrapeLead(db as never, lead)).toBeNull();
    expect(calls.at(-1)?.value).toEqual({ status: 'rejected' });
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });
  it('does not put CRO numbers into the UK-only company_number field', async () => {
    const { db, calls } = database();
    await approveScrapeLead(db as never, row('cro', 'cro'), { orgId: 'org', pipelineId: 'pipe', country: 'IE' });
    expect(calls.find((c) => c.op === 'insert')?.value).toMatchObject({ company_number: null, country: 'IE' });
  });
});
