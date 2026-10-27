import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useDesktopPreference } from './useDesktopNotifications';
import { replyPopups, type ReplyAlertView } from '../lib/replyAlertsView';

/** Reuse the Jobs opt-in, silently baseline each user/org and close notifications when that scope changes. */
export function useReplyDesktopNotifications(alerts: ReplyAlertView[], loading: boolean, scope: string | null) {
  const { enabled, permission, setEnabled } = useDesktopPreference();
  const navigate = useNavigate();
  const history = useRef<{ scope: string | null; previous: ReplyAlertView[] | null; delivered: Set<string> }>({ scope: null, previous: null, delivered: new Set() });
  const opened = useRef(new Set<Notification>());
  useEffect(() => {
    const notifications = opened.current;
    return () => { notifications.forEach(n => { n.onclick = null; n.close(); }); notifications.clear(); };
  }, [scope]);
  useEffect(() => {
    if (history.current.scope !== scope) history.current = { scope, previous: null, delivered: new Set() };
    if (!scope || loading) return;
    const state = history.current;
    const popups = replyPopups({ previous: state.previous, next: alerts, hidden: document.hidden, enabled, permission });
    state.previous = alerts;
    for (const popup of popups) {
      if (state.delivered.has(popup.key)) continue;
      try {
        const notification = new Notification(popup.title, { body: popup.body, tag: `reply:${popup.key}`, silent: true });
        notification.onclick = () => { window.focus(); navigate(popup.href); notification.close(); };
        notification.onclose = () => opened.current.delete(notification);
        opened.current.add(notification); state.delivered.add(popup.key);
      } catch {
        console.error('reply alerts: desktop notification unavailable');
        setEnabled(false); break;
      }
    }
  }, [alerts, loading, scope, enabled, permission, navigate, setEnabled]);
}
