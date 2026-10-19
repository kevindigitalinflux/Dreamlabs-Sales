import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RawLead, ScrapeJob } from '../types';
import { mergeScrapeLeads } from './scrapeMerge';

const state = vi.hoisted(() => ({ jobs: [] as ScrapeJob[], rows: [] as RawLead[], error: null as string | null }));
vi.mock('react-router', () => ({ useParams: () => ({ id: 'job' }) }));
vi.mock('../hooks/useScrapeJob', () => ({ useScrapeJob: () => ({ job: state.jobs[0], jobs: state.jobs,
  rawLeads: mergeScrapeLeads(state.rows), loading: false, error: state.error, refresh: vi.fn() }) }));
vi.mock('../hooks/usePipeline', () => ({ usePipeline: () => ({ pipelines: [] }) }));
vi.mock('../hooks/useOrgApiSettings', () => ({ useOrgApiSettings: () => ({ settings: [] }) }));
vi.mock('../hooks/useRawLeadActions', () => ({ useRawLeadActions: () => ({ approve: vi.fn(), reject: vi.fn(), skip: vi.fn() }) }));
import { ScraperJob as Results } from '../pages/ScraperJob';

const group = { id: '12345678-1234-4234-8234-123456789abc', sources: ['google_places', 'companies_house'] as const };
function setup() {
  state.error = null;
  state.jobs = [
    { id: 'job', org_id: 'org', status: 'completed', sources: ['google_places'], icp_params: { scrape_group: group } },
    { id: 'registry', org_id: 'org', status: 'completed', sources: ['companies_house'], icp_params: { scrape_group: group } },
  ] as unknown as ScrapeJob[];
  const defaults = { scrape_job_id: 'job', owner_name: null, phone: null, email: null, address: null,
    postcode: null, google_rating: null, review_count: null, vertical: null, raw_data: null, duplicate_of: null,
    approved_by: null, approved_at: null, created_at: '2026-10-19' };
  state.rows = [{ ...defaults, id: 'place', business_name: 'Acme', city: 'London', status: 'pending', source: 'google_places', source_id: 'place', website: 'acme.com' },
    { ...defaults, id: 'company', business_name: 'ACME LIMITED', city: 'London', status: 'duplicate', source: 'companies_house', source_id: '12345678', website: null }];
}

describe('combined results review view', () => {
  it('offers one Deep find action after approval, with no legacy enrichment buttons', () => {
    setup();
    let html = renderToStaticMarkup(createElement(Results));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Deep find for ACME LIMITED"/);
    state.rows.forEach((r) => { r.status = 'approved'; });
    html = renderToStaticMarkup(createElement(Results));
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*aria-label="Deep find for ACME LIMITED"/);
    expect(html).not.toContain('Enrich with Apollo');
    expect(html).not.toContain('Find email with Hunter');
    expect(html).not.toContain('aria-label="Approve ');
  });
  it('shows one review row with both sources, registry number and safe merged website', () => {
    setup();
    const html = renderToStaticMarkup(createElement(Results));
    expect(html.match(/aria-label="Approve /g)).toHaveLength(1);
    expect(html).toContain('Google Places + Companies House');
    expect(html).toContain('Company 12345678');
    expect(html).toContain('href="https://acme.com/"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('Source details');
  });
  it('keeps successful rows reviewable when another source fails or never creates its job', () => {
    setup(); state.jobs[1].status = 'failed';
    let html = renderToStaticMarkup(createElement(Results));
    expect(html).toContain('Companies House could not finish');
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*aria-label="Reject ACME LIMITED"/);
    state.jobs.pop();
    html = renderToStaticMarkup(createElement(Results));
    expect(html).toContain('Companies House has not returned a job');
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*aria-label="Reject ACME LIMITED"/);
  });
  it('blocks review while another source runs or a refresh cannot load the complete list', () => {
    setup(); state.jobs[1].status = 'running'; state.jobs[1].created_at = new Date().toISOString();
    let html = renderToStaticMarkup(createElement(Results));
    expect(html).toContain('Review opens when all started sources finish');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Reject ACME LIMITED"/);
    state.jobs[1].status = 'completed'; state.error = 'Could not load all search results';
    html = renderToStaticMarkup(createElement(Results));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Reject ACME LIMITED"/);
  });
  it('allows review with the plain warning after a source runs for ten minutes', () => {
    setup(); state.jobs[1].status = 'running';
    state.jobs[1].created_at = new Date(Date.now() - 600_000).toISOString();
    const html = renderToStaticMarkup(createElement(Results));
    expect(html).toContain('One source did not finish. You can review what arrived.');
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*aria-label="Reject ACME LIMITED"/);
    expect(html).not.toContain('Review opens when all started sources finish');
  });
  it('offers a late matching pending row after an earlier member was rejected', () => {
    setup(); state.rows[0].status = 'rejected'; state.rows[1].status = 'pending';
    const html = renderToStaticMarkup(createElement(Results));
    expect(html.match(/aria-label="Approve /g)).toHaveLength(1);
  });
});
