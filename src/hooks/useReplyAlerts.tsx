import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import type { ReplyAlertView } from '../lib/replyAlertsView';
import { useReplyDesktopNotifications } from './useReplyDesktopNotifications';

interface ReplyAlertsValue {
  alerts: ReplyAlertView[]; count: number; loading: boolean; error: string | null; revision: number;
  refresh: () => Promise<void>; markRead: (replyId?: string) => Promise<string | null>;
}
const Context = createContext<ReplyAlertsValue | null>(null);
/** One scoped subscription shared by badge, banner, inbox and desktop popups. */
export function ReplyAlertsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth(); const { currentOrg } = useOrg(); const instance = useId();
  const userId = session?.user.id; const orgId = currentOrg?.id;
  const scope = userId && orgId ? `${userId}:${orgId}` : null;
  const activeScope = useRef(scope); activeScope.current = scope;
  const [state, setState] = useState<{ scope: string | null; alerts: ReplyAlertView[]; count: number; error: string | null; revision: number }>({ scope: null, alerts: [], count: 0, error: null, revision: 0 });
  const refresh = useCallback(async () => {
    if (!userId || !orgId) return;
    try {
      const { data, error, count } = await supabase.from('reply_notifications')
        .select('id,reply_id,read_at,reply:email_replies(id,preview,lead:leads(business_name))', { count: 'exact' })
        .eq('user_id', userId).eq('org_id', orgId).is('read_at', null).order('created_at', { ascending: false }).limit(100);
      if (error) throw new Error('Notification lookup failed');
      if (activeScope.current === scope) setState(old => ({ scope, alerts: (data ?? []) as unknown as ReplyAlertView[], count: count ?? 0, error: null, revision: old.revision + 1 }));
    } catch {
      console.error('reply alerts: notification lookup failed');
      if (activeScope.current === scope) setState(old => ({ scope, alerts: [], count: 0, error: 'Could not check new replies.', revision: old.revision + 1 }));
    }
  }, [userId, orgId, scope]);
  useEffect(() => {
    void refresh();
    if (!userId || !orgId) return;
    const channel = supabase.channel(`reply-alerts:${instance}:${scope}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'reply_notifications', filter: `user_id=eq.${userId}`,
    }, () => void refresh()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, userId, orgId, instance, scope]);
  const markRead = useCallback(async (replyId?: string) => {
    if (!userId || !orgId) return 'Sign in to read replies.';
    try {
      let query = supabase.from('reply_notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).eq('org_id', orgId).is('read_at', null);
      if (replyId) query = query.eq('reply_id', replyId);
      const { error } = await query;
      if (error) throw new Error('Read state save failed');
      await refresh(); return null;
    } catch { console.error('reply alerts: read state save failed'); return 'Could not mark replies read. Please try again.'; }
  }, [userId, orgId, refresh]);
  const ready = state.scope === scope;
  const alerts = useMemo(() => ready ? state.alerts : [], [ready, state.alerts]);
  const loading = !!scope && !ready;
  useReplyDesktopNotifications(alerts, loading || !!(ready && state.error), scope);
  return <Context.Provider value={{ alerts, count: ready ? state.count : 0, error: ready ? state.error : null, loading,
    revision: state.revision, refresh, markRead }}>{children}</Context.Provider>;
}
/** Current user's own reply alerts under the authenticated app provider. */
export function useReplyAlerts(): ReplyAlertsValue {
  const value = useContext(Context);
  if (!value) throw new Error('Reply alerts provider is missing');
  return value;
}
