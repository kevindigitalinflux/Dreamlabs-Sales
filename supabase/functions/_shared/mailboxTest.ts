import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ReplyInbox } from './replyPolling.ts';
import { IMAP_PRESETS, IMAP_MESSAGES, imapErrorCode } from './replyRules.ts';

/** A saved-credential INBOX login test only. No fetch, parse, send or notification creation. */
export async function testMailboxConnection(service: SupabaseClient, userId: string, create: (host: string, port: number, user: string, pass: string) => ReplyInbox) {
  let client: ReplyInbox | undefined;
  let lock: { release(): void } | undefined;
  try {
    const { data: settings, error } = await service.from('user_email_settings').select('*').eq('user_id', userId).maybeSingle();
    const { data: pass, error: passError } = await service.rpc('app_get_smtp_secret', { uid: userId });
    if (error || passError || !settings || !pass) throw new Error('Mailbox configuration unavailable');
    const preset = IMAP_PRESETS[String(settings.provider)];
    const host = preset?.host ?? settings.imap_host;
    const port = preset?.port ?? settings.imap_port;
    if (!host || !port || !settings.smtp_user) throw new Error('Mailbox configuration unavailable');
    client = create(host, port, settings.smtp_user, String(pass));
    await client.connect(); lock = await client.lock();
    const { error: healthError } = await service.from('user_email_settings').update({ imap_host: host, imap_port: port,
      last_imap_check_uid: settings.last_imap_check_uid ?? client.highestUid,
      last_imap_ok_at: new Date().toISOString(), last_imap_check_at: new Date().toISOString(), last_imap_error: null, last_imap_error_at: null }).eq('user_id', userId);
    if (healthError) throw new Error('Mailbox health save failed');
    return { ok: true as const, message: 'Reply detection is connected.' };
  } catch (error) {
    const code = imapErrorCode(error);
    console.error('email settings: inbox test failed');
    const { error: saveError } = await service.from('user_email_settings').update({ last_imap_error: code, last_imap_error_at: new Date().toISOString() }).eq('user_id', userId);
    if (saveError) console.error('email settings: health save failed');
    return { ok: false as const, code, error: IMAP_MESSAGES[code] };
  } finally {
    lock?.release();
    try { await client?.logout(); } catch { console.error('email settings: inbox close failed'); }
  }
}
