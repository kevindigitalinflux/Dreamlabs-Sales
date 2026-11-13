export type QueueStep = 'access_read' | 'context_read' | 'context_assess' | 'details_read' | 'details_write' | 'contact_write' | 'note_write' | 'readiness_write' | 'apply_proven' | 'refresh_readiness' | 'recovery_read';
export class QueueStepError extends Error {
  constructor(readonly step: QueueStep, readonly retryable = true) { super(step); this.name = 'QueueStepError'; }
}
export interface QueueRetryOptions { wait?: (ms: number) => Promise<void>; random?: () => number }
/** Kevin clarified three retries after the initial attempt: four total, each retry with a fresh read. */
export async function queueRetry<T>(step: QueueStep, work: () => Promise<T>, options: QueueRetryOptions): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await work(); }
    catch (error) {
      const code = error instanceof QueueStepError ? error.step : step;
      if (attempt === 3 || (error instanceof QueueStepError && !error.retryable)) {
        console.error('Background check step failed', code);
        throw new QueueStepError(code, false);
      }
      await (options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(25 + Math.floor((options.random ?? Math.random)() * 50));
    }
  }
}
