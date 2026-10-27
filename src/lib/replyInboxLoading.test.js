import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: null }));
vi.mock('react', () => ({ useCallback: callback => callback, useEffect: effect => effect(), useState: initial => [initial, value => { if (value?.rows) state.rows = value.rows; }] }));
vi.mock('../hooks/useOrg', () => ({ useOrg: () => ({ currentOrg: { id: 'org' } }) }));
vi.mock('../hooks/useReplyAlerts', () => ({ useReplyAlerts: () => ({ revision: 1, alerts: [{ reply_id: 'older-unread' }] }) }));
vi.mock('./supabase', () => ({ supabase: { from() {
  let ids;
  const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, in: (_field, values) => { ids = values; return q; },
    then: resolve => resolve({ error: null, data: ids ? ids.map(id => ({ id, received_at: '2026-01-01' })) : [{ id: 'recent-read', received_at: '2026-10-27' }] }) };
  return q;
} } }));
import { useReplies } from '../hooks/useReplies';
it('loads unread replies even when they are older than the recent-reply window', async () => {
  useReplies();
  await vi.waitFor(() => expect(state.rows?.map(row => row.id)).toContain('older-unread'));
  expect(state.rows.map(row => row.id)).toContain('recent-read');
});
