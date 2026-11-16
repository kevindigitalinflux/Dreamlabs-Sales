import type { VerifyResult } from './verifyEmail.js'

/** Stops repeated stalled SMTP calls for one domain; kept inside this wrapper process. */
export class DomainStallBreaker {
  private readonly domains = new Map<string, { failures: number; until: number }>()
  constructor(private readonly now: () => number = Date.now) {}

  blocked(domain: string): boolean {
    const state = this.domains.get(domain)
    if (!state?.until) return false
    if (this.now() < state.until) return true
    this.domains.delete(domain)
    return false
  }

  record(domain: string, answer: Pick<VerifyResult, 'status' | 'reason'>): void {
    if (answer.status !== 'unverifiable' || !['timeout', 'checker_error'].includes(answer.reason)) {
      this.domains.delete(domain)
      return
    }
    const failures = (this.domains.get(domain)?.failures ?? 0) + 1
    this.domains.set(domain, { failures, until: failures >= 2 ? this.now() + 600_000 : 0 })
  }
}
