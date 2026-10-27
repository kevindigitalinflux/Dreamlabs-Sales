import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { replySenderMatches } from './replyMatch.ts';
import { automaticMail, htmlReplyText, imapErrorCode, messageIds, optOutSuspected, replyLeadPatch, replyPreview, replyRecipients, uidWindow } from './replyRules.ts';

export interface ParsedReply {
  messageId?: string; inReplyTo?: string; references?: string; subject?: string; text?: string; html?: string; date?: string;
  from: { address?: string }; headers: { key: string; value: string }[]; attachments: unknown[];
}
export interface ReplyContext {
  replyId: string; senderId: string; lead: Record<string, unknown>; body: string; subject: string;
  sent: { id: string; org_id: string; lead_id: string; sent_by: string; to_email: string; sequence_enrollment_id: string | null };
  sequence: { auto_draft_on_reply: boolean; icp_id: string | null } | null;
}
export type AutoDraftReply = (context: ReplyContext) => Promise<string | null>;
export interface ReplyInbox {
  highestUid: number; connect(): Promise<void>; lock(): Promise<{ release(): void }>;
  fetch(range: string): AsyncIterable<{ uid: number; source?: Uint8Array; internalDate?: Date | string }>; logout(): Promise<void>; abort?(): void;
}
const checked = async (query: PromiseLike<{ error: unknown }>) => { const result = await query; if (result.error) throw new Error('Reply database operation failed'); };
/** Effects are independent after the durable insert; payloads never enter logs. */
async function effect(name: string, work: () => Promise<void>): Promise<void> {
  try { await work(); } catch { console.error(`reply check: ${name} failed`); }
}
/** Retain existing discover-run bounce accounting, without storing the unrelated message. */
async function recordBounce(service: SupabaseClient, userId: string): Promise<void> {
  const { data: membership } = await service.from('org_members').select('org_id').eq('user_id', userId).limit(1).maybeSingle();
  if (!membership) return;
  const { data: run } = await service.from('autopilot_runs').select('id,bounce_count').eq('org_id', membership.org_id).eq('mode', 'discover').eq('status', 'active').maybeSingle();
  if (!run) return;
  const count = Number(run.bounce_count) + 1;
  await checked(service.from('autopilot_runs').update({ bounce_count: count, ...(count >= 10 ? { status: 'cancelled', cancel_reason: 'bounce threshold reached' } : {}) }).eq('id', run.id));
}
/** A header match is mailbox-scoped and sender-validated before any real-reply effect. */
export async function processReplyMessage(service: SupabaseClient, userId: string, mail: ParsedReply, autoDraft: AutoDraftReply, now = new Date()) {
  const result = { matched: 0, automatic: 0, bounces: 0 };
  const kind = automaticMail(mail.headers.map(h => [h.key, h.value]), mail.subject ?? '', mail.from?.address ?? '');
  if (kind) {
    if (kind === 'bounce') { result.bounces++; await effect('bounce accounting', () => recordBounce(service, userId)); }
    else result.automatic++;
    return result;
  }
  const ownId = messageIds(mail.messageId ?? '')[0];
  if (!ownId) return result;
  // In-Reply-To is untrusted. Restrict every candidate to this mailbox's own genuine sent logs.
  const candidates = [...new Set([...messageIds(mail.inReplyTo ?? ''), ...messageIds(mail.references ?? '').reverse()])];
  let sent: ReplyContext['sent'] | null = null;
  for (const id of candidates.slice(0, 20)) {
    const { data, error } = await service.from('email_logs').select('id,lead_id,sequence_enrollment_id,org_id,to_email,sent_by')
      .eq('message_id', id).eq('status', 'sent').eq('sent_by', userId).maybeSingle();
    if (error) throw new Error('Could not check reply match');
    if (data?.lead_id && data.org_id) { sent = data as ReplyContext['sent']; break; }
  }
  if (!sent) return result;
  const { data: lead, error: leadError } = await service.from('leads').select('*').eq('id', sent.lead_id).eq('org_id', sent.org_id).maybeSingle();
  if (leadError) throw new Error('Could not check reply lead');
  // Second forgery guard: a leaked Message-ID alone cannot authorize a different From address.
  if (!lead || !replySenderMatches(mail.from?.address, sent.to_email, lead.email)) return result;
  const body = mail.text || htmlReplyText(mail.html ?? '');
  const preview = replyPreview(body);
  const { data: inserted, error: insertError } = await service.from('email_replies').upsert({
    email_log_id: sent.id, lead_id: sent.lead_id, org_id: sent.org_id, from_email: mail.from.address,
    subject: (mail.subject ?? '').slice(0, 500), body, preview, message_id: ownId,
    opt_out_suspected: optOutSuspected(body), attachment_count: mail.attachments.length,
    thread_references: messageIds(mail.references ?? '').join(' '), received_at: now.toISOString(),
  }, { onConflict: 'message_id', ignoreDuplicates: true }).select('id');
  if (insertError) throw new Error('Could not save reply');
  const replyId = inserted?.[0]?.id as string | undefined;
  if (!replyId) return result; // Unique Message-ID: reprocessing never repeats notes, drafts or alerts.
  result.matched++;
  if (sent.sequence_enrollment_id) await effect('pause enrollment', () => checked(service.from('sequence_enrollments')
    .update({ status: 'paused' }).eq('id', sent!.sequence_enrollment_id).eq('lead_id', sent!.lead_id).in('status', ['active','paused'])));
  await effect('lead follow-up', async () => {
    const patch = replyLeadPatch(lead.stage, lead.next_action_date, now);
    // Compare the read snapshot so a later human stage/date edit is never overwritten.
    let query = service.from('leads').update(patch).eq('id', sent!.lead_id).eq('org_id', sent!.org_id).eq('stage', lead.stage);
    query = lead.next_action_date == null ? query.is('next_action_date', null) : query.eq('next_action_date', lead.next_action_date);
    if (Object.keys(patch).length) await checked(query);
  });
  await effect('lead note', () => checked(service.from('lead_notes').insert({ lead_id: sent!.lead_id, created_by: null, note_type: 'general', content: `Reply received: ${preview}` })));
  await effect('notifications', async () => {
    const { data, error } = await service.rpc('reply_alert_recipients', { target_reply: replyId });
    if (error) throw new Error('Could not check recipients');
    const recipients = replyRecipients(sent!.sent_by, data ?? []);
    if (recipients.length) await checked(service.from('reply_notifications').upsert(recipients.map(user_id => ({ reply_id: replyId, org_id: sent!.org_id, user_id })), { onConflict: 'reply_id,user_id', ignoreDuplicates: true }));
  });
  if (sent.sequence_enrollment_id) await effect('optional draft', async () => {
    const { data: enrollment, error } = await service.from('sequence_enrollments').select('sequence:email_sequences(auto_draft_on_reply,icp_id)').eq('id', sent!.sequence_enrollment_id).eq('lead_id', sent!.lead_id).maybeSingle();
    if (error) throw new Error('Could not check auto draft');
    const sequence = (enrollment as unknown as { sequence: ReplyContext['sequence'] } | null)?.sequence ?? null;
    if (!sequence?.auto_draft_on_reply) return;
    const draftId = await autoDraft({ replyId, senderId: userId, lead, body, subject: mail.subject ?? '', sent: sent!, sequence });
    if (draftId) await checked(service.from('email_replies').update({ ai_draft_log_id: draftId }).eq('id', replyId));
  });
  return result;
}

/** Scan a bounded ascending UID span; save the watermark only after all admitted messages were handled. */
export async function pollMailbox(service: SupabaseClient, user: { user_id: string; last_imap_check_uid: number | null; reply_alerts_after?: string }, inbox: ReplyInbox,
  parse: (source: Uint8Array) => Promise<ParsedReply>, autoDraft: AutoDraftReply, deadline: number) {
  const totals = { matched: 0, automatic: 0, bounces: 0, error: null as string | null };
  let lock: { release(): void } | undefined;
  let watermark = user.last_imap_check_uid;
  const abortTimer = setTimeout(() => inbox.abort?.(), Math.max(1, deadline - Date.now() - 1000));
  try {
    await inbox.connect(); lock = await inbox.lock();
    const window = uidWindow(watermark, inbox.highestUid);
    if (window?.baseline) watermark = window.to;
    else if (window) {
      const messages: { uid: number; source?: Uint8Array; internalDate?: Date | string }[] = [];
      for await (const message of inbox.fetch(`${window.from}:${window.to}`)) messages.push(message);
      for (const message of messages.sort((a,b) => a.uid - b.uid)) {
        if (message.uid < window.from || message.uid > window.to) continue;
        if (user.reply_alerts_after && (!message.internalDate || !Number.isFinite(new Date(message.internalDate).getTime()))) throw new Error('Reply receipt time unavailable');
        // Use IMAP's server receipt time, not the sender-controlled Date header, to keep pre-release mail quiet.
        if (user.reply_alerts_after && message.internalDate && new Date(message.internalDate).getTime() < Date.parse(user.reply_alerts_after)) {
          watermark = message.uid; continue;
        }
        if (Date.now() >= deadline - 5000 || !message.source) throw new Error('Reply check budget or source unavailable');
        const counts = await processReplyMessage(service, user.user_id, await parse(message.source), autoDraft);
        totals.matched += counts.matched; totals.automatic += counts.automatic; totals.bounces += counts.bounces;
        watermark = message.uid;
      }
      watermark = window.to;
    }
    await checked(service.from('user_email_settings').update({ last_imap_check_uid: watermark, last_imap_check_at: new Date().toISOString(),
      last_imap_ok_at: new Date().toISOString(), last_imap_error: null, last_imap_error_at: null }).eq('user_id', user.user_id));
  } catch (error) {
    totals.error = imapErrorCode(error);
    console.error('reply check: mailbox failed');
    await effect('mailbox health', () => checked(service.from('user_email_settings').update({ last_imap_check_uid: watermark,
      last_imap_error: totals.error, last_imap_error_at: new Date().toISOString() }).eq('user_id', user.user_id)));
  } finally {
    lock?.release();
    try { await inbox.logout(); } catch { console.error('reply check: mailbox close failed'); }
    clearTimeout(abortTimer);
  }
  return totals;
}
