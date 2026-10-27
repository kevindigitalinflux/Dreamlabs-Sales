import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import { useReplyAlerts } from './useReplyAlerts';
import type { EmailReply } from '../lib/replies';

/** Lead-scoped summary or reply detail. Explicit FK names avoid the two email_logs relationships being ambiguous. */
export function useReplies(leadId?: string, replyId?: string | null) {
  const { currentOrg } = useOrg(); const { revision } = useReplyAlerts();
  const scope = `${currentOrg?.id ?? ''}:${leadId ?? ''}:${replyId ?? ''}`;
  const [state, setState] = useState<{ scope: string; rows: EmailReply[]; error: string | null }>({ scope: '', rows: [], error: null });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(v => v + 1), []);
  useEffect(() => {
    let cancelled = false;
    if (!currentOrg) return;
    void (async () => {
      try {
        let query = supabase.from('email_replies').select('*,lead:leads(*),original:email_logs!email_replies_email_log_id_fkey(id,subject,body,sent_at,to_email),draft:email_logs!email_replies_ai_draft_log_id_fkey(id,status,subject,body)')
          .eq('org_id', currentOrg.id).order('received_at', { ascending: false }).limit(100);
        if (leadId) query = query.eq('lead_id', leadId);
        if (replyId) query = query.eq('id', replyId);
        const { data, error } = await query;
        if (error) throw new Error('Reply lookup failed');
        if (!cancelled) setState({ scope, rows: (data ?? []) as unknown as EmailReply[], error: null });
      } catch {
        console.error('replies: reply lookup failed');
        if (!cancelled) setState({ scope, rows: [], error: 'Could not load replies. Please try again.' });
      }
    })();
    return () => { cancelled = true; };
  }, [currentOrg, leadId, replyId, scope, revision, version]);
  const ready = state.scope === scope;
  return { rows: ready ? state.rows : [], error: ready ? state.error : null, loading: !!currentOrg && !ready, refresh };
}
