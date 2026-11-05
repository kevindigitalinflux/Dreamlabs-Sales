import type { WorkerResult } from './workerClient.ts';
import type { VerifyReply } from './workerRules.ts';

/** Atomic state storage scoped by the caller to one organisation and run. */
export interface VerifyGateStore {
  read(): Promise<{ state: Record<string, unknown>; version: string }>;
  swap(version: string, state: Record<string, unknown>): Promise<boolean>;
}
interface DomainState { starts?: number[]; nextAt?: number; pendingUntil: number; blocked: boolean; blockedReason?:string; timeoutRetryOwner?:string; hosted?: boolean; canaryDone?: boolean; hostedUnverifiable?: boolean; waitingNoted?: boolean; noted?: boolean }
export interface VerifyGateAttempt {retry?:boolean;retryOwner?:string}
const skipped = (line: string): WorkerResult<VerifyReply> => ({ ok: false, failure: 'busy', line });
const slow = (): WorkerResult<VerifyReply> => ({ ok: false, failure: 'timeout', domainNoteSuppressed: true, line: 'This mail server answers too slowly to check, so these are best guesses.' });
const outOfTime = (): WorkerResult<VerifyReply> => ({ ok: true, value: { status: 'unverifiable', reason: 'lead_time_exhausted' }, domainNoteSuppressed: true });

/** Durable per-run breaker and domain sliding window; no usage is reserved while waiting. */
export class RunVerifyGate {
  private unavailable = false;
  private localHosted = new Set<string>();
  private notices = new Set<string>();
  private localBlocked = new Set<string>();
  /** One plain fallback notice for this lead. */
  lines(): string[] { return [...this.notices, ...(this.unavailable ? ['Run-wide email check pacing was unavailable; checks ran without it.'] : [])]; }
  constructor(private store: VerifyGateStore, private now = () => Date.now(),
    private sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
    private isHosted: (domain: string) => Promise<boolean> = async () => false) {}
  async run(email: string, budget: number, perform: (timeout: number) => Promise<WorkerResult<VerifyReply>>, attemptOptions:VerifyGateAttempt={}): Promise<WorkerResult<VerifyReply>> {
    const domain = email.toLowerCase().split('@')[1];
    if (!domain) return skipped('The email checker could not read this domain.');
    const hostedSkip = (): WorkerResult<VerifyReply> => ({ ok: true, value: { status: 'unverifiable', reason: 'hosted_unverifiable' }, domainNoteSuppressed: true });
    if (this.localHosted.has(domain)) return hostedSkip();
    if (this.localBlocked.has(domain)&&!attemptOptions.retry) return slow();
    let hosted = false;
    let canaryDone = false;
    let dispatch: Promise<WorkerResult<VerifyReply>> | null = null;
    const once = () => dispatch ??= perform(33000).then(result => {
      if (hosted && !canaryDone && ((!result.ok && result.failure === 'timeout') || (result.ok && !['valid', 'invalid'].includes(result.value.status)))) {
        this.localHosted.add(domain);
        this.notices.add(domain.replace(/[^a-z0-9.-]/g, '').slice(0, 253) + ': hosted mail could not confirm the canary address; further SMTP checks were skipped.');
      }
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
        if (prior && (!Number.isFinite(prior.pendingUntil) || typeof prior.blocked !== 'boolean'
          || (prior.starts !== undefined ? !Array.isArray(prior.starts) || prior.starts.some(t => !Number.isFinite(t)) : !Number.isFinite(prior.nextAt)))) throw new Error('Invalid checker state');
        if (prior?.hostedUnverifiable) return hostedSkip();
        const ownedRetry=attemptOptions.retry&&prior?.blockedReason==='timeout'&&!!attemptOptions.retryOwner
          &&prior.timeoutRetryOwner===attemptOptions.retryOwner&&!prior.hosted;
        if (prior?.blocked&&!ownedRetry) return slow();
        if(attemptOptions.retry&&(!prior?.blocked||ownedRetry))this.localBlocked.delete(domain);
        hosted = prior?.hosted ?? await this.isHosted(domain);
        canaryDone = prior?.canaryDone ?? false;
        if (prior?.pendingUntil && prior.pendingUntil <= this.now()) return slow(); // An abandoned call is never assumed safe.
        // Migrate one recent legacy start without retaining the old fixed spacing.
        const starts = (prior?.starts ?? (prior?.nextAt ? [prior.nextAt - 12001] : []))
          .filter(t => t > this.now() - 60000).sort((a,b) => a-b);
        const windowAt = starts.length >= 4 ? starts[starts.length - 4]! + 60000 : 0;
        const wait = Math.max(0, (prior?.pendingUntil || 0) - this.now(), windowAt - this.now());
        if (wait > 0) {
          // A lease is an upper bound, not a prediction of the worker's response time.
          if (windowAt - this.now() > deadline - this.now() || this.now() >= deadline) {
            if (!prior?.waitingNoted) {
              if (!await this.store.swap(snapshot.version, {...snapshot.state,[domain]:{...prior,waitingNoted:true}})) continue;
              this.notices.add(domain + ': The email check was skipped while this domain was waiting for its next check.');
            }
            return {ok:true,value:{status:'unverifiable',reason:'waiting_for_domain'},domainNoteSuppressed:true};
          }
          await this.sleep(Math.min(wait, 1000));
          continue;
        }
        started = this.now(); token = started + 33000 + 2000;
        if (started > deadline) return outOfTime();
        if (await this.store.swap(snapshot.version, { ...snapshot.state, [domain]: { ...prior, starts: [...starts, started], pendingUntil: token, blocked: false, blockedReason:undefined,timeoutRetryOwner:undefined, hosted, canaryDone } })) { acquired = true; break; }
        if (attempt === 99) throw new Error('Checker state contention');
      }
      if (!acquired) throw new Error('Checker state unavailable');
      const result = this.now() <= deadline ? await once()
        : outOfTime();
      const blocked = !result.ok ? result.failure === 'timeout' : result.value.reason === 'timeout' || result.value.reason === 'provider_blocks_checks';
      const blockedReason=blocked?(!result.ok?'timeout':result.value.reason):undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        const snapshot = await this.store.read();
        const prior = snapshot.state[domain] as DomainState | undefined;
        if (prior?.pendingUntil !== token) throw new Error('Checker lease changed');
        const relevant = result.ok ? ['unverifiable','risky'].includes(result.value.status) : result.failure === 'timeout';
        const starts = prior?.starts ?? [];
        const finishedStarts = dispatch ? starts : starts.filter((_t,index) => index !== starts.lastIndexOf(started));
        if (await this.store.swap(snapshot.version, { ...snapshot.state, [domain]: { ...prior, starts: finishedStarts, pendingUntil: 0, blocked, blockedReason,
          timeoutRetryOwner:blockedReason==='timeout'&&!hosted&&!attemptOptions.retry?attemptOptions.retryOwner:undefined,
          hosted, canaryDone: dispatch ? true : canaryDone, hostedUnverifiable: this.localHosted.has(domain), noted: prior?.noted || (!!dispatch && relevant) } })) return relevant && prior?.noted ? {...result,domainNoteSuppressed:true} : result;
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
