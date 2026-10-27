import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ raw: null, queries: [] }));
vi.mock('react', () => ({ useEffect: effect => effect(), useMemo: calculate => calculate(), useState: initial => [initial, value => { if (value?.emailReplies) state.raw = value; }] }));
vi.mock('../hooks/useOrg', () => ({ useOrg: () => ({ currentOrg: { id: 'org', role: 'contractor' } }) }));
vi.mock('../hooks/useProfiles', () => ({ useProfiles: () => ({ profiles: [] }) }));
vi.mock('./supabase', () => ({ supabase: { from(table) {
  let columns;
  const q = { select: value => { columns = value; return q; }, eq: () => q, then: resolve => {
    state.queries.push({ table, columns });
    const ambiguous = table === 'email_replies' && !columns.includes('email_replies_email_log_id_fkey');
    resolve({ error: ambiguous ? { message: 'ambiguous relationship' } : null, data: table === 'email_replies' ? [{ received_at: '2026-10-27' }]
      : table === 'email_logs' ? [{ status: 'sent', sent_at: '2026-10-27' }] : [] });
  } }; return q;
} } }));
import { useAnalytics } from '../hooks/useAnalytics';
import { computeEmailStats } from './analytics';
it('analytics keeps the sent-log visibility join unambiguous after reply/draft foreign keys are added', async () => {
  useAnalytics('month');
  await vi.waitFor(() => expect(state.raw).not.toBeNull());
  expect(computeEmailStats(state.raw.emailLogs, state.raw.emailReplies, 'month', new Date('2026-10-27T12:00:00Z'))).toEqual({ sent: 1, replies: 1, replyRate: 1 });
});
