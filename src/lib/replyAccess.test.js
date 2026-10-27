import { expect, it } from 'vitest';
import { loadVisibleReply } from '../../supabase/functions/_shared/replyAccess';
import { replyDatabase } from './replyTestDatabase';
function fixture(member = true, visible = true) {
  const db = replyDatabase({ org_members: member ? [{ org_id: 'org', user_id: 'user' }] : [],
    email_replies: [{ id: 'reply', org_id: 'org', lead_id: 'lead', email_log_id: 'sent', body: 'Private', message_id: '<reply@fixture.invalid>' }],
    email_logs: [{ id: 'sent', org_id: 'org', lead_id: 'lead', to_email: 'trusted@fixture.invalid', sent_by: 'sender' }],
    leads: [{ id: 'lead', org_id: 'org' }] });
  return { db, caller: { rpc: async () => ({ data: visible, error: null }) } };
}
it.each([[false, true], [true, false]])('requires both membership and lead visibility (%s,%s)', async (member, visible) => {
  const { db, caller } = fixture(member, visible);
  expect(await loadVisibleReply(db.service, caller, 'user', 'reply')).toBeNull();
});
it('uses only the stored original target and makes no writes for draft access', async () => {
  const { db, caller } = fixture();
  expect(await loadVisibleReply(db.service, caller, 'user', 'reply')).toMatchObject({ context: { sent: { to_email: 'trusted@fixture.invalid' } } });
  expect(db.writes).toEqual([]);
});
