import type { WorkerResult } from './workerClient.ts';
import type { VerifyReply } from './workerRules.ts';

/** Atomic state storage scoped by the caller to one organisation and run. */
export interface VerifyGateStore {
  read(): Promise<{ state: Record<string, unknown>; version: string }>;
  swap(version: string, state: Record<string, unknown>): Promise<boolean>;
}
interface DomainState { nextAt: number; pendingUntil: number; blocked: boolean }
const skipped = (line: string): WorkerResult<VerifyReply> => ({ ok: false, failure: 'busy', line });
const slow = (): WorkerResult<VerifyReply> => ({ ok: false, failure: 'timeout', line: 'This mail server answers too slowly to check, so these are best guesses.' });

/** Durable per-run breaker and conservative spacing; no usage is reserved while waiting. */
export class RunVerifyGate {
  private unavailable = false;
  private localBlocked = new Set<string>();
  /** One plain fallback notice for this lead. */
  lines(): string[] { return this.unavailable ? ['Run-wide email check pacing was unavailable; checks ran without it.'] : []; }
  constructor(private store: VerifyGateStore, private now = () => Date.now(),
    private sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}
  async run(email: string, budget: number, perform: (timeout: number) => Promise<WorkerResult<VerifyReply>>): Promise<WorkerResult<VerifyReply>> {
    const domain = email.toLowerCase().split('@')[1];
    if (!domain) return skipped('The email checker could not read this domain.');
    if (this.localBlocked.has(domain)) return slow();
    let dispatch: Promise<WorkerResult<VerifyReply>> | null = null;
    const once = () => dispatch ??= perform(33000).then(result => {
      if ((!result.ok && result.failure === 'timeout') || (result.ok && ['timeout', 'provider_blocks_checks'].includes(result.value.reason))) this.localBlocked.add(domain);
      return result;
    });
    if (this.unavailable) return once();
    const deadline = this.now() + budget;
    let started = 0;
    let token = 0;
    let acquired = false;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const snapshot = await this.store.read();
        const prior = snapshot.state[domain] as DomainState | undefined;
        if (prior && (!Number.isFinite(prior.nextAt) || !Number.isFinite(prior.pendingUntil) || typeof prior.blocked !== 'boolean')) throw new Error('Invalid checker state');
        if (prior?.blocked) return slow();
        if (prior?.pendingUntil && prior.pendingUntil <= this.now()) return slow(); // An abandoned call is never assumed safe.
        const wait = Math.max(0, (prior?.pendingUntil || prior?.nextAt || 0) - this.now());
        if (wait > 0) {
          if (wait + 33000 > deadline - this.now()) return skipped('The email check was skipped while this domain was waiting for its next check.');
          await this.sleep(Math.min(wait, 1000));
          continue;
        }
        started = this.now(); token = started + Math.min(33000, deadline - started) + 2000;
        if (deadline - started < 33000) return skipped('The email check was skipped because its time allowance was reached.');
        if (await this.store.swap(snapshot.version, { ...snapshot.state, [domain]: { nextAt: started + 12001, pendingUntil: token, blocked: false } })) { acquired = true; break; }
        if (attempt === 99) throw new Error('Checker state contention');
      }
      if (!acquired) throw new Error('Checker state unavailable');
      const result = deadline - this.now() >= 33000 ? await once()
        : skipped('The email check was skipped because its time allowance was reached.');
      const blocked = !result.ok ? result.failure === 'timeout' : result.value.reason === 'timeout' || result.value.reason === 'provider_blocks_checks';
      for (let attempt = 0; attempt < 100; attempt++) {
        const snapshot = await this.store.read();
        const prior = snapshot.state[domain] as DomainState | undefined;
        if (prior?.pendingUntil !== token) throw new Error('Checker lease changed');
        if (await this.store.swap(snapshot.version, { ...snapshot.state, [domain]: { nextAt: started + 12001, pendingUntil: 0, blocked } })) return result;
      }
      throw new Error('Checker result could not be saved');
    } catch (error) {
      if (dispatch) {
        // A failed worker promise must never cause a second request; an already returned result remains usable.
        try { await dispatch; } catch { throw error; }
      }
      if (!this.unavailable) console.error('Deep find run-wide email pacing unavailable');
      this.unavailable = true;
      return once();
    }
  }
}
