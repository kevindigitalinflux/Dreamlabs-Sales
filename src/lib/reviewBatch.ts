import {runRowBatch} from './rowSelection';
export const REVIEW_BATCH_LIMIT=50;
/** Resolve current rows only; stale selection can never become a write. */
export function selectedReviewRows<T>(rows:T[], selected:ReadonlySet<string>, key:(row:T)=>string):T[] {
 return rows.filter(row=>selected.has(key(row))).slice(0,REVIEW_BATCH_LIMIT);
}
/** Keep every single-row permission, audit and failure boundary in the caller's action. */
export function runReviewBatch<T>(rows:T[],selected:ReadonlySet<string>,key:(row:T)=>string,action:(row:T)=>Promise<string|null>) {
 return runRowBatch(selectedReviewRows(rows,selected,key),action);
}
