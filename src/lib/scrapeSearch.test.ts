import { describe, expect, it, vi } from 'vitest';
import { startScrapeSearch } from './scrapeSearch';

describe('multi-source search starts', () => {
  it('starts all selected sources with one durable marker and isolates both returned and thrown failures', async () => {
    const invoke = vi.fn(async (fn: string, options: { body: Record<string, unknown> }) => {
      expect(options.body.icp_params).toMatchObject({ country: 'GB', scrape_group: { id: 'group', sources: ['google_places', 'companies_house', 'cro'] } });
      if (fn === 'scrape-google-places') return { data: { job_id: 'places' }, error: null };
      if (fn === 'scrape-companies-house') return { data: { error: 'No key' }, error: null };
      throw new Error('Offline');
    });
    const result = await startScrapeSearch(['google_places', 'companies_house', 'cro'], { icp_params: { country: 'GB' }, pipeline_id: 'pipeline' }, 'group', invoke);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(result.jobIds).toEqual(['places']);
    expect(result.notes).toEqual(['Companies House could not start. Check Settings and try again.', 'Irish CRO could not start. Check Settings and try again.']);
  });
  it('reports empty responses and HTTP errors without navigating to a missing job', async () => {
    const result = await startScrapeSearch(['google_places'], {}, 'group', async () => ({ data: null, error: new Error('HTTP') }));
    expect(result.jobIds).toEqual([]);
    expect(result.notes).toHaveLength(1);
  });
});
