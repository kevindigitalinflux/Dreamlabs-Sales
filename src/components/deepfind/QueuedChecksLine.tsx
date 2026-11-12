import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { queuedChecksText } from '../../lib/queuedChecksText';

/** Session-scoped reads use the queue's lead visibility policy; no realtime subscription is needed. */
export function QueuedChecksLine({ leadId, runId }: { leadId: string; runId: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let loading = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (interval !== undefined) { clearInterval(interval); interval = undefined; } };
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const { data, error } = await supabase.from('deep_find_check_queue').select('status,verdict')
          .eq('lead_id', leadId).eq('run_id', runId).limit(30);
        if (error) throw error;
        if (!active) return;
        const counts = { queued: 0, running: 0, valid: 0, invalid: 0, unconfirmed: 0 };
        for (const row of data ?? []) {
          if (row.status === 'queued') counts.queued++;
          else if (row.status === 'running') counts.running++;
          else if (row.status === 'skipped' || row.verdict === 'unverifiable') counts.unconfirmed++;
          else if (row.verdict === 'valid' || row.verdict === 'exists') counts.valid++;
          else if (row.verdict === 'invalid' || row.verdict === 'not_found') counts.invalid++;
        }
        setText(queuedChecksText({ state: 'ready', ...counts }));
        if (counts.queued + counts.running > 0) interval ??= setInterval(() => void load(), 30_000);
        else stop();
      } catch (error) {
        console.error('Background check status read failed', error);
        if (active) { setText('Background check status is unavailable'); stop(); }
      } finally { loading = false; }
    };
    setText(null);
    void load();
    return () => { active = false; stop(); };
  }, [leadId, runId]);
  return text ? <p role="status" className="break-words text-[13px]">{text}</p> : null;
}
