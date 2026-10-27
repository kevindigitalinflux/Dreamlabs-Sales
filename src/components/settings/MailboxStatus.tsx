import { useEffect } from 'react';
import { useEmailSettings } from '../../hooks/useEmailSettings';
import { MailboxStatusView } from './MailboxStatusView';
/** Refresh mailbox health without subscribing to an unpublished settings table. */
export function MailboxStatus({ warningOnly = false, compact = false }: { warningOnly?: boolean; compact?: boolean }) {
  const { settings, refresh, error } = useEmailSettings();
  useEffect(() => { const timer = setInterval(() => void refresh(), 60_000); return () => clearInterval(timer); }, [refresh]);
  if (error) return <p role="status" className="text-sm text-muted">Could not check reply detection. <a className="underline" href="/settings/email">Check inbox settings</a></p>;
  return <MailboxStatusView settings={settings} warningOnly={warningOnly} compact={compact} />;
}
