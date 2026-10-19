import type { ScrapeJob } from '../types';
import { readScrapeGroup } from '../../supabase/functions/_shared/scrapeGroup';

export const SCRAPE_JOB_TIMEOUT_MS = 10 * 60 * 1000;

export function isScrapeJobTimedOut(job: ScrapeJob, now = Date.now()): boolean {
  return (job.status === 'pending' || job.status === 'running')
    && now - Date.parse(job.created_at) >= SCRAPE_JOB_TIMEOUT_MS;
}

export function isScrapeJobFinished(job: ScrapeJob, now = Date.now()): boolean {
  return job.status === 'completed' || job.status === 'failed' || isScrapeJobTimedOut(job, now);
}

export function shouldPollScrapeJobs(jobs: ScrapeJob[], now = Date.now()): boolean {
  if (!jobs.length || jobs.some((job) => !isScrapeJobFinished(job, now))) return true;
  return jobs.some((job) => readScrapeGroup(job.icp_params)?.sources
    .some((source) => !jobs.some((member) => member.sources.includes(source))));
}
