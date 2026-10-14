import { describe, expect, it } from 'vitest'
import { RateLimiter } from './rateLimit.js'

describe('RateLimiter', () => {
  it('allows up to the limit then blocks within the window', () => {
    let now = 1000
    const rl = new RateLimiter(3, 60_000, () => now)
    expect([rl.take('a'), rl.take('a'), rl.take('a'), rl.take('a')]).toEqual([true, true, true, false])
  })
  it('keeps keys independent', () => {
    const rl = new RateLimiter(1, 60_000, () => 0)
    expect(rl.take('a')).toBe(true)
    expect(rl.take('b')).toBe(true)
    expect(rl.take('a')).toBe(false)
  })
  it('resets after the window', () => {
    let now = 0
    const rl = new RateLimiter(1, 1000, () => now)
    expect(rl.take('a')).toBe(true)
    expect(rl.take('a')).toBe(false)
    now = 1001
    expect(rl.take('a')).toBe(true)
  })
})
