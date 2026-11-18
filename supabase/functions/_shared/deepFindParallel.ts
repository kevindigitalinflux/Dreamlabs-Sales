/** Read persisted parallelism defensively; the SQL constraint remains the authority. */
export function parallelInvocations(value: unknown): number {
  return typeof value==='number' && Number.isInteger(value) ? Math.max(1,Math.min(5,value)) : 3;
}

/** Exact run backstop; the separate per-check sixty-minute window remains unchanged. */
export function checkWindowEnd(startedAt: number, leadCount: unknown, parallel: unknown): number {
  const count = typeof leadCount === 'number' && Number.isFinite(leadCount) ? Math.max(0,leadCount) : 0;
  return startedAt + Math.min(8*3600000, Math.max(3*3600000, count*120000/parallelInvocations(parallel)+3600000));
}
