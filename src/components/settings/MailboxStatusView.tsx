import { IMAP_MESSAGES, mailboxState, type MailboxHealth, type ImapError } from '../../../supabase/functions/_shared/replyRules';

/** Safe text-only status, also used below the composer's Send button. */
export function MailboxStatusView({ settings, warningOnly = false, compact = false, now = new Date() }: {
  settings: (MailboxHealth & { is_verified?: boolean }) | null; warningOnly?: boolean; compact?: boolean; now?: Date;
}) {
  const status = mailboxState(settings, now);
  if (warningOnly && (!settings?.is_verified || status === 'working')) return null;
  const label = status === 'working' ? 'Working' : status === 'problem' ? 'Problem' : 'Not connected';
  const code = settings?.last_imap_error;
  const problem = code && Object.hasOwn(IMAP_MESSAGES, code) ? IMAP_MESSAGES[code as ImapError] : IMAP_MESSAGES.check_failed;
  return <div className={compact ? 'text-xs text-muted' : 'rounded-lg border border-line bg-surface p-3 text-sm text-offwhite'} role="status">
    <p className="font-semibold">Reply detection: {label}</p>
    {status !== 'working' && <p>{status === 'problem' ? problem : 'Replies to this email will not be picked up: connect your inbox.'} <a className="underline" href="/settings/email">Connect your inbox</a></p>}
  </div>;
}
