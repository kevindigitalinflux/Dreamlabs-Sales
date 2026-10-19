import { describe, expect, it } from 'vitest';
import {
  isFinishedState, mapCampaign, mapDeepFind, mapScrape, mapSelectedOutreach, nameLeads, shorten,
  type CampaignRunInput, type DeepFindLeadInput, type DeepFindRunInput, type ScrapeJobInput, type SelectedLeadInput, type SelectedRunInput,
} from './model';

describe('combined scrape search labels', () => {
  it('gives source jobs a shared search marker and keeps source-specific links and counts', () => {
    const base: ScrapeJobInput = { id: 'p', status: 'completed', icp_raw_input: 'Cleaners in London',
      results_count: 2, approved_count: 0, created_by: 'user', started_at: null, completed_at: null, created_at: '2026-10-19',
      icp_params: { scrape_group: { id: '12345678-1234-4234-8234-123456789abc', sources: ['google_places', 'companies_house'] } }, sources: ['google_places'] };
    const places = mapScrape(base, 2, 0);
    const registry = mapScrape({ ...base, id: 'r', sources: ['companies_house'] }, 1, 0);
    expect(places.title).toContain('Search 12345678');
    expect(registry.title).toContain('Search 12345678');
    expect(places.title).toContain('Google Places');
    expect(registry.title).toContain('Companies House');
    expect(places.detail).toContain('combined search');
    expect(places.needsYou).toBe(2);
    expect(registry.href).toBe('/scraper/jobs/r');
    expect(mapScrape({ ...base, created_by: null }, 2, 0).title).toBe('Cleaners in London');
  });
  it('keeps partial results reviewable after a grouped source fails', () => {
    const result = mapScrape({ id: 'r', status: 'failed', icp_raw_input: 'Cleaners', results_count: 0,
      approved_count: 0, created_by: 'user', started_at: null, completed_at: null, created_at: '2026-10-19',
      icp_params: { scrape_group: { id: '12345678-1234-4234-8234-123456789abc', sources: ['companies_house'] } },
      sources: ['companies_house'] }, 2, 0);
    expect(result.state).toBe('needs_you');
    expect(result.needsYou).toBe(2);
    expect(result.detail).toContain('source stopped early');
  });
});

describe('nameLeads', () => {
  it('names zero, one, two and many leads', () => {
    expect(nameLeads([])).toBe('No leads yet');
    expect(nameLeads(['Love Living'])).toBe('Love Living');
    expect(nameLeads(['Love Living', 'FMJ Property'])).toBe('FMJ Property, Love Living');
    expect(nameLeads(['d', 'b', 'a', 'c', 'e'])).toBe('a, b +3');
  });
  it('trims, sorts without regard to case and skips empty or missing names', () => {
    expect(nameLeads(['  zeta ', 'Alpha', null, undefined, '', '   '])).toBe('Alpha, zeta');
  });
  it('counts leads by total, not by readable names (a lead the viewer cannot name still counts)', () => {
    expect(nameLeads([], 3)).toBe('3 leads');
    expect(nameLeads([], 1)).toBe('1 lead');
    expect(nameLeads(['Love Living'], 4)).toBe('Love Living +3');
    expect(nameLeads(['A', 'B', 'C'])).toBe('A, B +1');
  });
  it('keeps duplicate names (two real leads share a name)', () => {
    expect(nameLeads(['Acme', 'Acme', 'Acme'])).toBe('Acme, Acme +1');
  });
});

describe('shorten', () => {
  it('collapses whitespace and cuts long text with an ellipsis', () => {
    expect(shorten('cleaning   firms\n in Hackney', 60)).toBe('cleaning firms in Hackney');
    expect(shorten('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
    expect(shorten('x'.repeat(10), 10)).toBe('xxxxxxxxxx');
  });
});

describe('isFinishedState', () => {
  it('is true only for done, failed and stopped', () => {
    expect(['needs_you', 'running', 'done', 'failed', 'stopped'].map((s) => isFinishedState(s as never))).toEqual([false, false, true, true, true]);
  });
});

const dfRun = (over: Partial<DeepFindRunInput> = {}): DeepFindRunInput => ({
  id: 'run-1', status: 'active', lead_count: 3, started_at: '2026-10-14T10:00:00Z', finished_at: null, ...over,
});
const dfLead = (over: Partial<DeepFindLeadInput> = {}): DeepFindLeadInput => ({
  status: 'done', people_found: 0, domains: {}, business_name: 'Alpha', company_number: null, ...over,
});

describe('mapDeepFind', () => {
  it('shows a running run with progress and names the leads', () => {
    const job = mapDeepFind(dfRun(), [dfLead({ business_name: 'Love Living' }), dfLead({ business_name: 'FMJ Property', status: 'running' }), dfLead({ business_name: 'Third', status: 'queued' })]);
    expect(job).toMatchObject({
      id: 'deep_find:run-1', kind: 'deep_find', sourceId: 'run-1', title: 'FMJ Property, Love Living +1', state: 'running',
      detail: '1 of 3 leads done', progress: { done: 1, total: 3 }, needsYou: 0, canStop: true, canDelete: false,
      href: '/pipeline/deep-find/run-1', finishedAt: null,
    });
  });
  it('needs-you beats running and keeps the progress', () => {
    const waiting = dfLead({ business_name: 'Love Living', domains: { named_by_web: [{ name: 'Jonathan Love', role: 'Partner' }] } });
    const job = mapDeepFind(dfRun(), [waiting, dfLead({ status: 'running' })]);
    expect(job.state).toBe('needs_you');
    expect(job.needsYou).toBe(1);
    expect(job.detail).toBe('1 lead needs you (choose a company or check people)');
    expect(job.progress).toEqual({ done: 1, total: 3 });
    expect(job.canStop).toBe(true);
    expect(job.canDelete).toBe(false);
  });
  it('a running lead with the same data does not count as needing the user', () => {
    const waiting = dfLead({ status: 'running', domains: { named_by_web: [{ name: 'Jonathan Love', role: 'Partner' }] } });
    expect(mapDeepFind(dfRun(), [waiting]).state).toBe('running');
  });
  it('shows a completed run as done with its people count and allows delete', () => {
    const job = mapDeepFind(dfRun({ status: 'completed', finished_at: '2026-10-14T11:00:00Z', lead_count: 2 }), [dfLead({ people_found: 2 }), dfLead({ people_found: 1, business_name: 'B' })]);
    expect(job).toMatchObject({ state: 'done', detail: '2 leads, 3 people added', finishedAt: '2026-10-14T11:00:00Z', canStop: false, canDelete: true });
    expect(job.deleteWarning).toBe('People already added to leads stay.');
  });
  it('uses singular words for one lead and one person', () => {
    const job = mapDeepFind(dfRun({ status: 'completed', lead_count: 1, finished_at: 'x' }), [dfLead({ people_found: 1 })]);
    expect(job.detail).toBe('1 lead, 1 person added');
  });
  it('shows a cancelled run as stopped and a finished run that still needs the user as needs-you but deletable with a warning', () => {
    expect(mapDeepFind(dfRun({ status: 'cancelled', finished_at: 'x' }), [dfLead(), dfLead({ status: 'queued' })])).toMatchObject({ state: 'stopped', detail: 'Stopped after 1 of 3 leads' });
    const waiting = dfLead({ domains: { named_by_web: [{ name: 'Jonathan Love', role: 'Partner' }] } });
    const job = mapDeepFind(dfRun({ status: 'completed', finished_at: 'x', lead_count: 1 }), [waiting]);
    expect(job).toMatchObject({ state: 'needs_you', canDelete: true });
    expect(job.deleteWarning).toBe('This job still needs you: deleting it discards those choices. People already added to leads stay.');
  });
  it('counts total from lead_count when rows are fewer (rows the viewer cannot see) and from rows when more', () => {
    expect(mapDeepFind(dfRun({ lead_count: 5 }), [dfLead()]).progress).toEqual({ done: 1, total: 5 });
    expect(mapDeepFind(dfRun({ lead_count: 1 }), [dfLead(), dfLead()]).progress).toEqual({ done: 2, total: 2 });
  });
  it('copes with a run that has no lead rows at all', () => {
    expect(mapDeepFind(dfRun({ lead_count: 2 }), [])).toMatchObject({ title: '2 leads', state: 'running', detail: '0 of 2 leads done' });
  });
});

const selRun = (over: Partial<SelectedRunInput> = {}): SelectedRunInput => ({ id: 'sel-1', status: 'active', started_at: '2026-10-14T09:00:00Z', ...over });
const selLead = (over: Partial<SelectedLeadInput> = {}): SelectedLeadInput => ({
  status: 'sent', email_log_id: null, business_name: 'Alpha', updated_at: '2026-10-14T09:30:00Z', ...over,
});

describe('mapSelectedOutreach', () => {
  it('shows a running run with progress', () => {
    const job = mapSelectedOutreach(selRun(), [selLead(), selLead({ status: 'queued', business_name: 'B' }), selLead({ status: 'working', business_name: 'C' })], new Map());
    expect(job).toMatchObject({
      id: 'selected_outreach:sel-1', state: 'running', detail: '1 of 3 leads handled', progress: { done: 1, total: 3 },
      href: '/outreach/autopilot', canStop: true, canDelete: false, title: 'Alpha, B +1',
    });
  });
  it('counts only needs-input rows whose draft is still unsent as needing the user', () => {
    const rows = [selLead({ status: 'needs_input', email_log_id: 'log-open', business_name: 'A' }), selLead({ status: 'needs_input', email_log_id: 'log-sent', business_name: 'B' })];
    const job = mapSelectedOutreach(selRun(), rows, new Map([['log-open', 'draft'], ['log-sent', 'sent']]));
    expect(job.state).toBe('needs_you');
    expect(job.needsYou).toBe(1);
    expect(job.detail).toBe('1 draft is waiting for you');
    const settled = mapSelectedOutreach(selRun(), rows, new Map([['log-open', 'sent'], ['log-sent', 'sent']]));
    expect(settled.state).toBe('running');
  });
  it('finished run: done with sent count, finishedAt is the newest lead update, delete allowed with a warning', () => {
    const job = mapSelectedOutreach(selRun({ status: 'completed' }), [selLead({ updated_at: '2026-10-14T10:00:00Z' }), selLead({ updated_at: '2026-10-14T12:00:00Z', business_name: 'B' }), selLead({ status: 'skipped', business_name: 'C' })], new Map());
    expect(job).toMatchObject({ state: 'done', detail: '2 of 3 sent', finishedAt: '2026-10-14T12:00:00Z', canDelete: true, canStop: false });
    expect(job.deleteWarning).toBe('Emails already sent and drafts in Emails stay.');
  });
  it('cancelled run is stopped; a finished run with no lead rows falls back to started_at', () => {
    expect(mapSelectedOutreach(selRun({ status: 'cancelled' }), [selLead()], new Map())).toMatchObject({ state: 'stopped', detail: 'Stopped after 1 of 1' });
    expect(mapSelectedOutreach(selRun({ status: 'completed' }), [], new Map()).finishedAt).toBe('2026-10-14T09:00:00Z');
  });
});

const scrapeJob = (over: Partial<ScrapeJobInput> = {}): ScrapeJobInput => ({
  id: 'job-1', status: 'completed', icp_raw_input: 'cleaning firms in Hackney', results_count: 24, approved_count: 0, created_by: 'user-1',
  started_at: '2026-10-14T08:00:00Z', completed_at: '2026-10-14T08:05:00Z', created_at: '2026-10-14T07:59:00Z', ...over,
});

describe('mapScrape', () => {
  it('running and pending jobs are running with no stop and no delete', () => {
    for (const status of ['pending', 'running'] as const) {
      expect(mapScrape(scrapeJob({ status, completed_at: null }), 0)).toMatchObject({ state: 'running', detail: 'Searching for leads…', canStop: false, canDelete: false, progress: null });
    }
  });
  it('completed with results waiting is needs-you, with a warning that unreviewed results go with it', () => {
    const job = mapScrape(scrapeJob(), 14);
    expect(job).toMatchObject({ state: 'needs_you', needsYou: 14, detail: '14 results to review', href: '/scraper/jobs/job-1', canDelete: true });
    expect(job.deleteWarning).toBe('Results you have not reviewed go with it. Leads you approved stay in your pipeline.');
    expect(mapScrape(scrapeJob(), 1).detail).toBe('1 result to review');
  });
  it('completed with nothing left to review is done', () => {
    const job = mapScrape(scrapeJob(), 0, 0);
    expect(job).toMatchObject({ state: 'done', detail: '24 results, 0 approved', needsYou: 0, finishedAt: '2026-10-14T08:05:00Z', canDelete: true, deleteBlockedReason: null });
    expect(job.deleteWarning).toBe('Leads you approved stay in your pipeline.');
  });
  it('shows the real approved count and blocks delete when approved leads exist', () => {
    const job = mapScrape(scrapeJob(), 0, 7);
    expect(job).toMatchObject({ state: 'done', detail: '24 results, 7 approved', canDelete: false, deleteWarning: null });
    expect(job.deleteBlockedReason).toBe('Leads approved from this search are in your pipeline, so it cannot be deleted.');
  });
  it('an unknown approved count (job beyond the counted window) stays deletable and shows only the results', () => {
    const job = mapScrape(scrapeJob(), 0, undefined);
    expect(job).toMatchObject({ detail: '24 results', canDelete: true, deleteBlockedReason: null });
    expect(job.deleteWarning).toBe('Leads you approved stay in your pipeline.');
    expect(mapScrape(scrapeJob({ results_count: 1 }), 0).detail).toBe('1 result');
  });
  it('an Autopilot search (no creator) with results left over is done, never needs-you', () => {
    const job = mapScrape(scrapeJob({ created_by: null }), 9, 3);
    expect(job).toMatchObject({ state: 'done', needsYou: 0, detail: 'Autopilot search: 24 results', canDelete: false });
    const open = mapScrape(scrapeJob({ created_by: null }), 9, 0);
    expect(open).toMatchObject({ state: 'done', needsYou: 0, canDelete: true, deleteBlockedReason: null });
    expect(open.deleteWarning).toBe('Leads Autopilot approved from it stay in your pipeline.');
    expect(mapScrape(scrapeJob({ created_by: null, results_count: 1 }), 0).detail).toBe('Autopilot search: 1 result');
  });
  it('a running job has no delete warning', () => {
    const job = mapScrape(scrapeJob({ status: 'running', completed_at: null }), 0);
    expect(job).toMatchObject({ canDelete: false, deleteWarning: null, deleteBlockedReason: null });
  });
  it('the other mappers never set a delete-blocked reason', () => {
    expect(mapDeepFind(dfRun(), []).deleteBlockedReason).toBeNull();
    expect(mapSelectedOutreach(selRun(), [], new Map()).deleteBlockedReason).toBeNull();
    expect(mapCampaign(campaign(), new Date()).deleteBlockedReason).toBeNull();
  });
  it('failed jobs never show raw error text and can be deleted', () => {
    const job = mapScrape(scrapeJob({ status: 'failed', completed_at: null }), 0);
    expect(job).toMatchObject({ state: 'failed', detail: 'The search did not finish', canDelete: true });
    expect(job.finishedAt).toBe('2026-10-14T08:00:00Z');
  });
  it('titles come from the saved search wording, shortened, with a fallback; startedAt falls back to created_at', () => {
    expect(mapScrape(scrapeJob({ icp_raw_input: 'x'.repeat(200) }), 0).title).toHaveLength(60);
    expect(mapScrape(scrapeJob({ icp_raw_input: null }), 0).title).toBe('Lead search');
    expect(mapScrape(scrapeJob({ icp_raw_input: '   ' }), 0).title).toBe('Lead search');
    expect(mapScrape(scrapeJob({ started_at: null }), 0).startedAt).toBe('2026-10-14T07:59:00Z');
  });
});

const campaign = (over: Partial<CampaignRunInput> = {}): CampaignRunInput => ({
  id: 'camp-1', status: 'active', started_at: '2026-10-12T09:00:00Z', ends_at: '2026-10-26T09:00:00Z', duration_days: 14, ...over,
});

describe('mapCampaign', () => {
  it('is read-only, never deletable or stoppable, and links to Autopilot', () => {
    const job = mapCampaign(campaign(), new Date('2026-10-14T12:00:00Z'));
    expect(job).toMatchObject({
      id: 'campaign:camp-1', kind: 'campaign', title: 'Autopilot campaign', state: 'running', detail: 'Day 3 of 14',
      progress: { done: 3, total: 14 }, href: '/outreach/autopilot', canStop: false, canDelete: false, deleteWarning: null,
    });
  });
  it('caps the day at the duration and maps finished states', () => {
    expect(mapCampaign(campaign(), new Date('2026-12-01T00:00:00Z')).detail).toBe('Day 14 of 14');
    expect(mapCampaign(campaign({ status: 'completed' }), new Date()).state).toBe('done');
    expect(mapCampaign(campaign({ status: 'cancelled', ends_at: null }), new Date())).toMatchObject({ state: 'stopped', finishedAt: '2026-10-12T09:00:00Z' });
  });
  it('copes with a missing duration', () => {
    expect(mapCampaign(campaign({ duration_days: null }), new Date('2026-10-14T12:00:00Z'))).toMatchObject({ detail: 'Day 3', progress: null });
  });
});
