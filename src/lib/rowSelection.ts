/** Toggle one row without mutating the previous selection. */
export function toggleRow(previous: ReadonlySet<string>, id: string): Set<string> {
 const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
}
/** Select or clear the current actionable group, discarding stale keys. */
export function selectRows(previous: ReadonlySet<string>, ids: string[]): Set<string> {
 return ids.length > 0 && ids.every(id => previous.has(id)) ? new Set() : new Set(ids);
}
/** Sequential bounded work, preserving every row's failure and continuing after exceptions. */
export async function runRowBatch<T>(rows: T[], action: (row: T) => Promise<string | null>) {
 const results: {row:T; error:string|null}[] = [];
 for (const row of rows) {
  try { results.push({row, error:await action(row)}); }
  catch (error) { results.push({row, error:error instanceof Error ? error.message : 'Could not save this row. Try again.'}); }
 }
 return results;
}
