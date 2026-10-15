import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from './useAuth';
import type { JobItem } from '../lib/jobs/model';
import { decidePopups } from '../lib/jobs/popups';
import { readSeen, writeSeen } from '../lib/jobs/seen';

const preferences = new Map<string, boolean>();
const CHANGE = 'dreamlabs-desktop-notifications';
const storage = () => { try { return window.localStorage; } catch { return null; } };
const permission = () => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;

export function useDesktopPreference() {
  const { session } = useAuth();
  const key = `dreamlabs.jobs.desktop.${session?.user.id ?? 'signed-out'}`;
  const [, rerender] = useState(0);
  useEffect(() => {
    const update = () => rerender((n) => n + 1);
    window.addEventListener(CHANGE, update);
    window.addEventListener('storage', update);
    window.addEventListener('focus', update);
    return () => {
      window.removeEventListener(CHANGE, update);
      window.removeEventListener('storage', update);
      window.removeEventListener('focus', update);
    };
  }, []);
  let enabled = preferences.get(key) ?? false;
  try {
    const saved = storage()?.getItem(key);
    if (saved != null) enabled = saved === 'on';
  } catch { /* in-memory preference still works */ }
  const setEnabled = (value: boolean) => {
    preferences.set(key, value);
    try { storage()?.setItem(key, value ? 'on' : 'off'); } catch { /* in-memory preference still works */ }
    window.dispatchEvent(new Event(CHANGE));
  };
  return { enabled, setEnabled, permission: permission(), userId: session?.user.id ?? null };
}

export function useDesktopNotifications(jobs: JobItem[], seen: ReadonlySet<string>, loading: boolean, orgId: string | null) {
  const { enabled, permission: allowed, userId } = useDesktopPreference();
  const navigate = useNavigate();
  const scope = userId && orgId ? `${userId}:${orgId}:popups` : null;
  const history = useRef<{ scope: string | null; previous: JobItem[] | null; delivered: Set<string> }>({ scope: null, previous: null, delivered: new Set() });
  const openNotifications = useRef(new Set<Notification>());
  useEffect(() => {
    const opened = openNotifications.current;
    return () => { opened.forEach((n) => { n.onclick = null; n.close(); }); opened.clear(); };
  }, [scope]);
  useEffect(() => {
    if (history.current.scope !== scope) history.current = { scope, previous: null, delivered: scope ? readSeen(storage(), scope) : new Set() };
    if (loading || !scope) return;
    const state = history.current;
    const popups = decidePopups({ previous: state.previous, next: jobs, seen: new Set([...seen, ...state.delivered]),
      hidden: document.hidden, enabled, permission: allowed, now: new Date() });
    state.previous = jobs;
    const active: Notification[] = [];
    for (const popup of popups) {
      try {
        const notification = new Notification(popup.title, { body: popup.body, tag: popup.tag, silent: true });
        notification.onclick = () => { window.focus(); navigate(popup.href); notification.close(); };
        notification.onclose = () => openNotifications.current.delete(notification);
        active.push(notification);
        popup.keys.forEach((key) => state.delivered.add(key));
      } catch { console.error('jobs: desktop notification could not be shown'); }
    }
    writeSeen(storage(), scope, state.delivered);
    // Keep clicks alive across progress refreshes; close only on scope change/unmount below.
    active.forEach((n) => openNotifications.current.add(n));
  }, [jobs, seen, loading, scope, enabled, allowed, navigate]);
}
