/** Read persisted parallelism defensively; the SQL constraint remains the authority. */
export function parallelInvocations(value: unknown): number {
  return typeof value==='number' && Number.isInteger(value) ? Math.max(1,Math.min(5,value)) : 3;
}
