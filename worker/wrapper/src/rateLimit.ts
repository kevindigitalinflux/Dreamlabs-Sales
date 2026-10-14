/** Simple fixed-window counter keyed by string. In-memory is enough: one wrapper instance, one VPS. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()

  constructor(private limit: number, private windowMs: number, private now: () => number = Date.now) {}

  /** Returns true when the call is allowed (and counts it), false when the key is over its limit. */
  take(key: string): boolean {
    const t = this.now()
    const entry = this.hits.get(key)
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs })
      this.prune(t)
      return true
    }
    if (entry.count >= this.limit) return false
    entry.count += 1
    return true
  }

  private prune(t: number) {
    if (this.hits.size < 1000) return
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k)
  }
}
