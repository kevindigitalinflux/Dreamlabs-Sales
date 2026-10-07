import { useState } from 'react';
import { Link } from 'react-router';
import { supabase } from '../../lib/supabase';
import type { ResolvedRunLeadRow } from './RunLeadGroups';
import type { EmailLog, Lead } from '../../types';
import { Button } from '../ui/Button';
import { NeedsInputReview } from './NeedsInputReview';

interface NeedsInputRowProps {
  row: ResolvedRunLeadRow;
  /** Called after the review closes so the status page can re-derive the row; carries any follow-up error to show. */
  onChanged: (followUpError: string | null) => void;
}

/** The action on a "Needs your input" row: review and send the parked draft, or open the lead when there is none. */
export function NeedsInputRow({ row, onChanged }: NeedsInputRowProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ lead: Lead; log: EmailLog } | null>(null);

  if (row.resolution === 'discarded' || row.resolution === 'no_draft' || !row.email_log_id) {
    return <Link to={`/pipeline/leads/${row.lead_id}`} className="text-sm font-semibold text-cyan hover:underline">Open lead to handle it</Link>;
  }
  const logId = row.email_log_id;

  async function start() {
    setLoading(true);
    setError(null);
    const [logRes, leadRes] = await Promise.all([
      supabase.from('email_logs').select('*').eq('id', logId).maybeSingle(),
      supabase.from('leads').select('*').eq('id', row.lead_id).maybeSingle(),
    ]);
    setLoading(false);
    if (logRes.error || leadRes.error || !logRes.data || !leadRes.data) {
      setError(logRes.error?.message ?? leadRes.error?.message ?? 'The draft or the lead is no longer available.');
      onChanged(null);
      return;
    }
    setSession({ log: logRes.data as EmailLog, lead: leadRes.data as Lead });
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button variant="secondary" onClick={() => void start()} disabled={loading} loading={loading}>Review and send</Button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {session && (
        <NeedsInputReview
          lead={session.lead}
          log={session.log}
          sequenceId={row.sequence_id}
          onDone={(err) => { setSession(null); onChanged(err); }}
        />
      )}
    </div>
  );
}
