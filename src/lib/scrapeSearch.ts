import { SOURCE_NAMES, type SearchSource } from './scrapeMerge';

type Invoke = (name: string, options: { body: Record<string, unknown> }) => PromiseLike<{ data: unknown; error: unknown }>;

/** A failed source must not discard another source's job. Notes never expose provider responses or credentials. */
export async function startScrapeSearch(sources: SearchSource[], body: Record<string, unknown>, groupId: string, invoke: Invoke) {
  const icp = body.icp_params as Record<string, unknown> | undefined;
  const results = await Promise.allSettled(sources.map(async (source) => {
    const response = await invoke(`scrape-${source.replaceAll('_', '-')}`, {
      body: { ...body, icp_params: { ...icp, scrape_group: { id: groupId, sources } } },
    });
    const data = response.data as { job_id?: string; error?: string } | null;
    if (response.error || data?.error || !data?.job_id) throw new Error('Source did not start');
    return data.job_id;
  }));
  const jobIds: string[] = [], notes: string[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') jobIds.push(result.value);
    else notes.push(`${SOURCE_NAMES[sources[i]]} could not start. Check Settings and try again.`);
  });
  return { jobIds, notes };
}
