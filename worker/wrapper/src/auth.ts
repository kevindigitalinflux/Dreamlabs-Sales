import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (value: string) => createHash('sha256').update(value).digest()

/** Constant-time check of the shared secret header. An empty or missing secret never matches. */
export function secretMatches(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false
  return timingSafeEqual(digest(expected), digest(provided))
}
