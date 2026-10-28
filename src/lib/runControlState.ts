/** Available controls; the database independently authorises every action. */
export function runControlState(run: {status: string; cancel_reason: string | null}, working: number, queued: number): string[] {
  if (run.status === 'active') return ['pause','stop'];
  if (run.status === 'paused') return [working ? 'pausing' : 'resume','stop'];
  if (run.status === 'cancelled' && run.cancel_reason === 'stopped by user' && queued > 0) return ['resume_stopped'];
  return [];
}
