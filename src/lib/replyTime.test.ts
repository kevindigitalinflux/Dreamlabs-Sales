import { expect, it } from 'vitest';
import { relativeReplyTime } from './replyAlertsView';
it('shows relative receipt times without negative future ages', () => {
 const now=Date.parse('2026-10-28T12:00:00Z');
 expect(relativeReplyTime('2026-10-28T11:58:00Z',now)).toBe('2 minutes ago');
 expect(relativeReplyTime('2026-10-28T13:00:00Z',now)).toBe('Just now');
 expect(relativeReplyTime('2026-10-27T12:00:00Z',now)).toBe('1 day ago');
});
