import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';
import { makeReplyInbox, parseReplyMime } from '../_shared/replyImap.ts';
import { pollMailbox } from '../_shared/replyPolling.ts';
import { autoDraftReply } from '../_shared/replyDraft.ts';
import { mailboxDue } from '../_shared/replyRules.ts';

/** Five-minute cron: bounded UID scans of each sender's INBOX; real replies only, optional drafts never sent. */
Deno.serve(async req => {
  const headers = { 'Content-Type': 'application/json' };
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'Forbidden' }, 403, headers);
  const deadline = Date.now() + 110_000;
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: users, error } = await service.from('user_email_settings')
    .select('user_id,imap_host,imap_port,smtp_user,last_imap_check_uid,last_imap_ok_at,reply_alerts_after')
    .eq('is_verified', true).not('imap_host', 'is', null).order('last_imap_ok_at', { ascending: true, nullsFirst: true });
  if (error) { console.error('reply check: mailbox list failed'); return json({ error: 'Could not load mailbox checks' }, 503, headers); }
  const totals = { matched: 0, bounces: 0, automatic: 0, checked: 0 };
  const errors: { user_id: string; error: string }[] = [];
  for (const user of users ?? []) {
    if (Date.now() >= deadline - 20_000) break;
    if (!mailboxDue(user.last_imap_ok_at, new Date())) continue;
    try {
      const { data: pass, error: passError } = await service.rpc('app_get_smtp_secret', { uid: user.user_id });
      if (passError || !pass || !user.imap_port || !user.smtp_user) throw new Error('Mailbox configuration unavailable');
      const result = await pollMailbox(service, user, makeReplyInbox(user.imap_host, user.imap_port, user.smtp_user, String(pass)),
        parseReplyMime, context => autoDraftReply(service, context, Math.max(1, deadline - Date.now() - 5000)), deadline);
      totals.matched += result.matched; totals.bounces += result.bounces; totals.automatic += result.automatic; totals.checked++;
      if (result.error) errors.push({ user_id: user.user_id, error: result.error });
    } catch {
      console.error('reply check: mailbox setup failed');
      errors.push({ user_id: user.user_id, error: 'check_failed' });
      const { error: healthError } = await service.from('user_email_settings').update({ last_imap_error: 'check_failed', last_imap_error_at: new Date().toISOString() }).eq('user_id', user.user_id);
      if (healthError) console.error('reply check: mailbox health save failed');
    }
  }
  return json({ ...totals, errors }, 200, headers);
});
