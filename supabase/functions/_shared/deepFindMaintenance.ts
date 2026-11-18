interface MaintenanceClient { rpc(name: string, args: Record<string, unknown>): PromiseLike<{data?:unknown;error?:unknown}> }
/** Complete only through the database's single conditional decision. */
export async function completeDeepFindRun(service: MaintenanceClient, runId: string): Promise<boolean> {
  const result = await service.rpc('deep_find_complete', {p_run:runId});
  if(result.error){console.error('deep find: complete run failed');return false;}
  return result.data===true;
}
/** Stale recovery tests and writes the same locked row, never a stale client snapshot. */
export async function maintainDeepFind(service: MaintenanceClient): Promise<void> {
  const result=await service.rpc('deep_find_housekeeping',{});
  if(result.error)throw new Error('Deep find housekeeping unavailable');
}
