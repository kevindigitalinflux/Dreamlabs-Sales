// Pure reply rules: no mail, network, database or model access.
export type ImapError = 'wrong_password' | 'imap_disabled' | 'cannot_connect' | 'check_failed';
export interface MailboxHealth { imap_host?: string | null; last_imap_ok_at?: string | null; last_imap_error?: string | null }
export const IMAP_MESSAGES: Record<ImapError, string> = {
  wrong_password: 'The inbox password was not accepted. Save your app password again.',
  imap_disabled: 'IMAP is switched off. Enable it in your email settings.',
  cannot_connect: 'Could not reach the inbox server. Check the host and port, then try again.',
  check_failed: 'Reply detection could not finish. Please test the connection again.',
};
export const IMAP_PRESETS: Record<string, { host: string; port: number }> = {
  gmail: { host: 'imap.gmail.com', port: 993 }, outlook: { host: 'outlook.office365.com', port: 993 }, yahoo: { host: 'imap.mail.yahoo.com', port: 993 },
};
/** Identify bounces before suppressing other automated mail. Header names are case-insensitive. */
export function automaticMail(headers: readonly (readonly [string, string])[], subject: string, from: string): 'bounce' | 'automatic' | null {
  if (/mailer-daemon|postmaster/i.test(from) || /undeliverable|delivery status notification|failure notice/i.test(subject)
    || headers.some(([k, v]) => k.toLowerCase() === 'content-type' && /report-type\s*=\s*["']?delivery-status/i.test(v))) return 'bounce';
  if (/out[ -]of[ -]office|automatic reply|auto[ -]?reply|away from (?:the )?office/i.test(subject)) return 'automatic';
  return headers.some(([name, value]) => {
    const key = name.toLowerCase();
    return (key === 'auto-submitted' && value.trim().toLowerCase() !== 'no')
      || ['x-autoreply', 'x-autorespond', 'x-auto-response-suppress'].includes(key)
      || (key === 'precedence' && /^(auto_reply|bulk|junk)\b/i.test(value.trim()));
  }) ? 'automatic' : null;
}
/** Remove quoted history for previews and opt-out suggestions, preserving only the new answer. */
export function stripReplyQuotes(body: string): string {
  const out: string[] = [];
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*>|^\s*On .{0,300}wrote:\s*$|^\s*-{2,}\s*(Original Message|Forwarded message)|^\s*From:\s*.+/i.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}
/** First nonblank new line only; safe to show in a small alert. */
export function replyPreview(body: string): string { return (stripReplyQuotes(body).split('\n').find(line => line.trim()) ?? '').trim().slice(0, 200); }
/** A text-only HTML fallback; never pass parsed HTML to the client renderer. */
export function htmlReplyText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?\s*>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, value => {
      const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
      if (named[value.toLowerCase()]) return named[value.toLowerCase()];
      const code = value.toLowerCase().startsWith('&#x') ? parseInt(value.slice(3), 16) : parseInt(value.slice(2), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }).split('\n').map(line => line.trim()).filter(Boolean).join('\n').trim();
}
/** Warning suggestion only; this function never changes a lead. */
export function optOutSuspected(body: string): boolean { return /\b(unsubscribe|remove me|stop (?:emailing|contacting|sending)|do not (?:email|contact)|don't (?:email|contact))\b/i.test(stripReplyQuotes(body)); }
/** UK calendar date, independent of the edge runtime timezone. */
export function londonDate(now: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
/** Move forward only, preserving an already-due follow-up and never touching last_contacted_at. */
export function replyLeadPatch(stage: string, nextAction: string | null, now: Date): { stage?: 'replied'; next_action_date?: string } {
  const today = londonDate(now);
  return { ...(['new_lead', 'contacted'].includes(stage) ? { stage: 'replied' as const } : {}), ...(!nextAction || nextAction > today ? { next_action_date: today } : {}) };
}
/** Candidate memberships must already be scoped to the reply's organization. */
export function replyRecipients(sender: string | null, members: { user_id: string; role: string; can_view: boolean }[]): string[] {
  return [...new Set(members.filter(m => m.can_view && (m.user_id === sender || m.role === 'admin')).map(m => m.user_id))];
}
/** Parse only bounded RFC-style message-id tokens; malformed/injected output must never become a mail header. */
export function messageIds(value: string): string[] {
  return [...new Set(value.match(/<[^<>\s@]+@[^<>\s@]+>/g) ?? [])].filter(id => id.length <= 250).slice(-20);
}
/** Thread headers from a trusted stored reply, with explicit injection rejection. */
export function threadingHeaders(inReplyTo?: string | null, references?: string | null): Record<string, string> {
  if (!inReplyTo) return {};
  if (/[\r\n]/.test(inReplyTo + (references ?? '')) || messageIds(inReplyTo)[0] !== inReplyTo.trim()) throw new Error('Invalid reply threading headers');
  return { 'In-Reply-To': inReplyTo.trim(), References: [...new Set([...messageIds(references ?? ''), inReplyTo.trim()])].slice(-20).join(' ') };
}
/** Health is fresh for 15 minutes; a visible error always wins. */
export function mailboxState(settings: MailboxHealth | null, now = new Date()): 'not_connected' | 'working' | 'problem' {
  if (settings?.last_imap_error) return 'problem';
  return settings?.imap_host && settings.last_imap_ok_at && now.getTime() - Date.parse(settings.last_imap_ok_at) < 15 * 60_000 ? 'working' : 'not_connected';
}
/** Inspect errors internally, returning only an allowlisted code. Never log the error payload. */
export function imapErrorCode(error: unknown): ImapError {
  const e = error && typeof error === 'object' ? error as { authenticationFailed?: boolean; message?: string; code?: string } : {};
  if (/imap.*(disabled|not enabled)|enable.*imap/i.test(e.message ?? '')) return 'imap_disabled';
  if (e.authenticationFailed || /auth|login|password|credentials/i.test(e.message ?? '')) return 'wrong_password';
  return /connect|timeout|ECONN|ENOTFOUND|socket/i.test(`${e.code ?? ''} ${e.message ?? ''}`) ? 'cannot_connect' : 'check_failed';
}
/** Avoid overlapping five-minute checks for the same healthy mailbox. */
export function mailboxDue(lastOk: string | null, now: Date): boolean { return !lastOk || now.getTime() - Date.parse(lastOk) >= 4 * 60_000; }
/** Empty or new mailbox baselines never backfill notifications. UID spans are bounded even with sparse UIDs. */
export function uidWindow(last: number | null, highest: number): { baseline: boolean; from: number; to: number } | null {
  if (last === null) return { baseline: true, from: highest, to: highest };
  if (last >= highest) return null;
  return { baseline: false, from: last + 1, to: Math.min(highest, last + 50) };
}
