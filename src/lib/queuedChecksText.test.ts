import { expect, it } from 'vitest'
import { queuedChecksText } from './queuedChecksText'

const counts = { queued: 0, running: 0, valid: 0, invalid: 0, unconfirmed: 0 }
it('shows nothing while loading', () => expect(queuedChecksText({ ...counts, state: 'loading' })).toBeNull())
it('shows nothing when ready with no rows', () => expect(queuedChecksText({ ...counts, state: 'ready' })).toBeNull())
it('reports a read error', () => expect(queuedChecksText({ ...counts, state: 'error' })).toBe('Background check status is unavailable'))
it('reports all queued and running rows', () => expect(queuedChecksText({ ...counts, state: 'ready', queued: 2, running: 1 })).toBe('3 addresses still being checked'))
it('uses the singular for one remaining address', () => expect(queuedChecksText({ ...counts, state: 'ready', running: 1 })).toBe('1 address still being checked'))
it('reports the completed totals', () => expect(queuedChecksText({ ...counts, state: 'ready', valid: 2, invalid: 3, unconfirmed: 4 })).toBe('Background checks finished: 2 confirmed, 3 not real, 4 could not be confirmed'))
