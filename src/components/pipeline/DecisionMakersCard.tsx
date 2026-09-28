import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { readableInvokeError } from '../../lib/invokeError';
import type { DecisionMakerCandidate } from '../../types';
import { Button } from '../ui/Button';

function candidateName(c: DecisionMakerCandidate): string {
  const first = c.first_name ?? '';
  const last = c.last_name ?? '';
  const name = `${first} ${last}`.trim();
  return name || 'Unknown name';
}

/**
 * Persistent list of every decision-maker candidate found for this lead
 * (via "Find decision maker") -- unlike the bulk-search review modal, this
 * is the lead's own permanent record, not a transient search result.
 * Subscribes to realtime updates scoped to this lead so an Apollo reveal or
 * phone webhook lands here live, with no polling and no manual refresh.
 */
export function DecisionMakersCard({ leadId }: { leadId: string }) {
  const [candidates, setCandidates] = useState<DecisionMakerCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorByCandidate, setErrorByCandidate] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void supabase.from('decision_maker_candidates').select('*').eq('lead_id', leadId).order('created_at').then(({ data }) => {
      if (!cancelled) { setCandidates((data as DecisionMakerCandidate[]) ?? []); setLoading(false); }
    });
    const channel = supabase
      .channel(`decision-makers-card-${leadId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'decision_maker_candidates', filter: `lead_id=eq.${leadId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setCandidates((prev) => prev.filter((c) => c.id !== (payload.old as { id: string }).id));
          return;
        }
        const row = payload.new as DecisionMakerCandidate;
        setCandidates((prev) => {
          const exists = prev.some((c) => c.id === row.id);
          return exists ? prev.map((c) => (c.id === row.id ? row : c)) : [...prev, row];
        });
      })
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [leadId]);

  async function handleReveal(candidate: DecisionMakerCandidate, field: 'reveal_email' | 'reveal_phone') {
    setBusyId(candidate.id);
    const { data, error } = await supabase.functions.invoke('reveal-decision-maker', {
      body: { candidate_id: candidate.id, [field]: true },
    });
    setBusyId(null);
    const apiError = error ? await readableInvokeError(error) : (data as { error?: string } | null)?.error;
    if (apiError) { setErrorByCandidate((prev) => ({ ...prev, [candidate.id]: apiError })); return; }
    setErrorByCandidate((prev) => {
      if (!(candidate.id in prev)) return prev;
      const next = { ...prev };
      delete next[candidate.id];
      return next;
    });
    // The realtime subscription above applies the actual update -- no local merge needed here.
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (candidates.length === 0) {
    return <p className="text-sm text-muted">No decision-makers found yet — use "Find decision maker" from the Pipeline list to search.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {candidates.map((candidate) => (
        <li key={candidate.id} className="rounded-lg bg-surface/60 p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase text-muted">{candidate.source}</span>
            <span className="font-semibold">{candidateName(candidate)}</span>
            {candidate.title && <span className="text-muted">— {candidate.title}</span>}
            {candidate.linkedin_url && (
              <a href={candidate.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-cyan">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> LinkedIn
              </a>
            )}
          </div>
          {candidate.source === 'hunter' && <p className="mt-1 text-success">{candidate.email}</p>}
          {candidate.source === 'apollo' && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => void handleReveal(candidate, 'reveal_email')}
                disabled={busyId === candidate.id || candidate.email_revealed}
                loading={busyId === candidate.id}
              >
                {candidate.email_revealed ? candidate.email! : busyId === candidate.id ? 'Revealing…' : 'Reveal email'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleReveal(candidate, 'reveal_phone')}
                disabled={busyId === candidate.id || candidate.phone_status !== 'not_requested'}
                loading={busyId === candidate.id}
              >
                {candidate.phone_status === 'revealed' ? candidate.phone!
                  : candidate.phone_status === 'pending' ? 'Waiting for phone number…'
                  : candidate.phone_status === 'not_found' ? 'No phone found'
                  : busyId === candidate.id ? 'Revealing…' : 'Reveal phone'}
              </Button>
            </div>
          )}
          {errorByCandidate[candidate.id] && <p role="alert" className="mt-1 text-xs text-danger">{errorByCandidate[candidate.id]}</p>}
        </li>
      ))}
    </ul>
  );
}
