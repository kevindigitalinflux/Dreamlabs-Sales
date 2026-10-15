import { useState } from 'react';
import { useDesktopPreference } from '../../hooks/useDesktopNotifications';
import { Card } from '../ui/Card';

export function DesktopNotificationsCard() {
  const { enabled, setEnabled, permission } = useDesktopPreference();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    if (enabled) { setEnabled(false); return; }
    setAsking(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      setEnabled(result === 'granted');
    } catch {
      console.error('jobs: notification permission request failed');
      setError('Could not enable desktop notifications. Try again.');
    } finally { setAsking(false); }
  }
  const status = permission === 'unsupported' ? 'Desktop notifications are not available in this browser.'
    : permission === 'denied' ? 'Blocked in this browser: allow notifications for this site in the browser settings'
    : enabled && permission === 'granted' ? 'On' : 'Off';
  return <Card><div className="flex flex-col gap-3">
    <h2 className="text-[18px] font-bold">Desktop notifications</h2>
    <p className="text-sm">When this tab is in the background, show a silent pop-up when a job needs you, finishes or fails.</p>
    <label className="flex items-center gap-3 text-sm">
      <input type="checkbox" role="switch" checked={enabled && permission === 'granted'}
        disabled={asking || permission === 'unsupported' || (!enabled && permission === 'denied')}
        onChange={() => void toggle()} className="h-5 w-5 accent-purple focus-visible:outline-2" />
      Desktop notifications
    </label>
    <p role="status" className="text-sm">{status}</p>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div></Card>;
}
