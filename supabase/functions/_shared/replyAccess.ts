import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ReplyContext } from './replyPolling.ts';

/** Service reads are gated by current membership AND the caller-session lead visibility RPC. */
export async function loadVisibleReply(service: SupabaseClient, caller: SupabaseClient, userId: string, replyId: string): Promise<{
  context: ReplyContext; messageId: string | null; references: string;
} | null> {
  const { data: reply, error } = await service.from('email_replies').select('*').eq('id', replyId).maybeSingle();
  if (error || !reply) return null;
  const [member, visible] = await Promise.all([
    service.from('org_members').select('user_id').eq('org_id', reply.org_id).eq('user_id', userId).maybeSingle(),
    caller.rpc('can_view_lead', { target_lead: reply.lead_id }),
  ]);
  if (member.error || !member.data || visible.error || visible.data !== true) return null;
  const [lead, sent] = await Promise.all([
    service.from('leads').select('*').eq('id', reply.lead_id).eq('org_id', reply.org_id).maybeSingle(),
    service.from('email_logs').select('*').eq('id', reply.email_log_id).eq('lead_id', reply.lead_id).eq('org_id', reply.org_id).maybeSingle(),
  ]);
  if (lead.error || sent.error || !lead.data || !sent.data?.to_email) return null;
  let sequence: ReplyContext['sequence'] = null;
  if (sent.data.sequence_enrollment_id) {
    const { data, error: sequenceError } = await service.from('sequence_enrollments').select('sequence:email_sequences(auto_draft_on_reply,icp_id)')
      .eq('id', sent.data.sequence_enrollment_id).eq('lead_id', reply.lead_id).maybeSingle();
    if (sequenceError) return null;
    sequence = (data as unknown as { sequence: ReplyContext['sequence'] } | null)?.sequence ?? null;
  }
  return { context: { replyId, senderId: sent.data.sent_by, lead: lead.data, sent: sent.data as ReplyContext['sent'],
    body: reply.body, subject: reply.subject ?? '', sequence }, messageId: reply.message_id ?? null, references: reply.thread_references ?? '' };
}
