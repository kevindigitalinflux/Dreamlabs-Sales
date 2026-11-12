import { expect, it } from 'vitest'
import { queuedChecksText, queuedChecksCounts } from './queuedChecksText'

const counts = { queued: 0, running: 0, valid: 0, invalid: 0, unconfirmed: 0 }
it('shows nothing while loading', () => expect(queuedChecksText({ ...counts, state: 'loading' })).toBeNull())
it('shows nothing when ready with no rows', () => expect(queuedChecksText({ ...counts, state: 'ready' })).toBeNull())
it('reports a read error', () => expect(queuedChecksText({ ...counts, state: 'error' })).toBe('Background check status is unavailable'))
it('reports all queued and running rows', () => expect(queuedChecksText({ ...counts, state: 'ready', queued: 2, running: 1 })).toBe('3 addresses still being checked'))
it('uses the singular for one remaining address', () => expect(queuedChecksText({ ...counts, state: 'ready', running: 1 })).toBe('1 address still being checked'))
it('reports the completed totals', () => expect(queuedChecksText({ ...counts, state: 'ready', valid: 2, invalid: 3, unconfirmed: 4 })).toBe('Background checks finished: 2 confirmed, 3 not real, 4 could not be confirmed'))
it('F2 ignores person_done skips in every count bucket', () => {
  expect(queuedChecksCounts([
    { status: 'skipped', verdict: null, reason: 'person_done' },
    { status: 'skipped', verdict: 'unverifiable', reason: 'person_done' },
  ])).toEqual(counts)
})
it('F2 reports one confirmed address without counting its skipped sibling formats as unconfirmed', () => {
  const result = queuedChecksCounts([
    { status: 'skipped', verdict: null, reason: 'person_done' },
    { status: 'done', verdict: 'valid', reason: 'deliverable' },
    { status: 'skipped', verdict: null, reason: 'person_done' },
  ])
  expect(queuedChecksText({ state: 'ready', ...result })).toBe('Background checks finished: 1 confirmed, 0 not real, 0 could not be confirmed')
})
it.each(['run_time_limit', 'no_access', 'not_configured', 'limit_reached', null, undefined])('F2 still counts another skipped reason %s as unconfirmed', reason => {
  expect(queuedChecksCounts([{ status: 'skipped', verdict: null, reason }])).toEqual({ ...counts, unconfirmed: 1 })
})
it('F2 preserves queued, running and every terminal verdict mapping', () => {
  expect(queuedChecksCounts([
    { status: 'queued', verdict: null, reason: 'person_done' },
    { status: 'running', verdict: null },
    { status: 'done', verdict: 'valid' }, { status: 'done', verdict: 'exists' },
    { status: 'done', verdict: 'invalid' }, { status: 'done', verdict: 'not_found' },
    { status: 'done', verdict: 'unverifiable' },
  ])).toEqual({ queued: 1, running: 1, valid: 2, invalid: 2, unconfirmed: 1 })
})
