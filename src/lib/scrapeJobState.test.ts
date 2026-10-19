import { describe, expect, it } from 'vitest';
import type { ScrapeJob } from '../types';
import { isScrapeJobFinished, isScrapeJobTimedOut, shouldPollScrapeJobs, SCRAPE_JOB_TIMEOUT_MS } from './scrapeJobState';

const now = Date.parse('2026-10-19T12:00:00Z');
const group = { id: '12345678-1234-4234-8234-123456789abc', sources: ['google_places', 'companies_house'] };
function job(status: ScrapeJob['status'], age = 0, grouped = false): ScrapeJob {
  return { status, created_at: new Date(now - age).toISOString(), sources: ['google_places'],
    icp_params: grouped ? { scrape_group: group } : {} } as ScrapeJob;
}

describe('scrape completion and polling', () => {
  it.each(['pending', 'running'] as const)('times out %s at exactly ten minutes from creation', (status) => {
    expect(SCRAPE_JOB_TIMEOUT_MS).toBe(600_000);
    expect(isScrapeJobTimedOut(job(status, 599_999), now)).toBe(false);
    expect(isScrapeJobTimedOut(job(status, 600_000), now)).toBe(true);
    expect(isScrapeJobFinished(job(status, 600_000), now)).toBe(true);
    expect(isScrapeJobTimedOut({ ...job(status), created_at: 'bad date' }, now)).toBe(false);
  });
  it.each(['completed', 'failed'] as const)('finishes %s without a timeout warning or polling', (status) => {
    expect(isScrapeJobTimedOut(job(status, 900_000), now)).toBe(false);
    expect(shouldPollScrapeJobs([job(status)], now)).toBe(false);
  });
  it('polls only until all expected sources exist and finish or time out', () => {
    const first = job('completed', 0, true);
    const second = { ...job('running', 599_999, true), sources: ['companies_house'] } as ScrapeJob;
    expect(shouldPollScrapeJobs([], now)).toBe(true);
    expect(shouldPollScrapeJobs([first], now)).toBe(true);
    expect(shouldPollScrapeJobs([first, second], now)).toBe(true);
    expect(shouldPollScrapeJobs([first, second], now + 1)).toBe(false);
    expect(shouldPollScrapeJobs([job('running')], now)).toBe(true);
    expect(shouldPollScrapeJobs([job('running', 600_000)], now)).toBe(false);
  });
});
