import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { DecisionMakerCandidate, Lead } from '../../types';
import { readableInvokeError } from '../../lib/invokeError';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface DecisionMakerReviewProps {
  open: boolean;
  resultsByLead: Record<string, DecisionMakerCandidate[]>;
  leadsById: Record<string, Lead>;
  onClose: () => void;
  onApplyHunter: (leadId: string, candidate: DecisionMakerCandidate) => Promise<string | null>;
}

function candidateName(c: DecisionMakerCandidate): string {
  const first = c.first_name ?? '';
  const last = c.last_name ?? '';
  const name = `${first} ${last}`.trim();
  return name || 'Unknown name';
}

/**
 * Review UI for the "Find decision maker" action. Unlike EnrichmentReview,
 * there's no diff-and-apply step — every action here (Hunter's "Add to
 * lead", Apollo's "Reveal email"/"Reveal phone") is its own explicit,
 * already-consented write. Subscribes to realtime updates on the visible
 * candidate rows so a phone number appears the moment Apollo's webhook
 * lands, with no polling.
 */
export function DecisionMakerReview({ open, resultsByLead, leadsById, onClose, onApplyHunter }: DecisionMakerReviewProps) {
  const [candidatesByLead, setCandidatesByLead] = useState<Record<string, DecisionMakerCandidate[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [errorByCandidate, setErrorByCandidate] = useState<Record<string, string>>({});

  useEffect(() => {
    setCandidatesByLead(resultsByLead);
    setAppliedIds(new Set());
    setErrorByCandidate({});
  }, [resultsByLead]);

  useEffect(() => {
    const allIds = Object.values(resultsByLead).flat().map((c) => c.id);
    if (allIds.length === 0) return;
    const channel = supabase
      .channel(`decision-maker-candidates-${allIds[0]}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'decision_maker_candidates', filter: `id=in.(${allIds.join(',')})` }, (payload) => {
        const updated = payload.new as DecisionMakerCandidate;
        setCandidatesByLead((prev) => {
          const list = prev[updated.lead_id];
          if (!list) return prev;
          return { ...prev, [updated.lead_id]: list.map((c) => (c.id === updated.id ? updated : c)) };
        });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // resultsByLead intentionally excluded beyond the id list captured above
    // — this subscription is set up once per search run (when the modal
    // opens with a new results set), not re-subscribed on every realtime
    // update it itself receives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsByLead]);

  async function handleApplyHunter(leadId: string, candidate: DecisionMakerCandidate) {
    setBusyId(candidate.id);
    const err = await onApplyHunter(leadId, candidate);
    setBusyId(null);
    if (err) setErrorByCandidate((prev) => ({ ...prev, [candidate.id]: err }));
    else setAppliedIds((prev) => new Set(prev).add(candidate.id));
  }

  async function handleReveal(candidate: DecisionMakerCandidate, field: 'reveal_email' | 'reveal_phone') {
    setBusyId(candidate.id);
    const { data, error } = await supabase.functions.invoke('reveal-decision-maker', {
      body: { candidate_id: candidate.id, [field]: true },
    });
    setBusyId(null);
    const apiError = error ? await readableInvokeError(error) : (data as { error?: string } | null)?.error;
    if (apiError) { setErrorByCandidate((prev) => ({ ...prev, [candidate.id]: apiError })); return; }
    const updated = (data as { candidate: DecisionMakerCandidate }).candidate;
    setCandidatesByLead((prev) => {
      const list = prev[updated.lead_id];
      if (!list) return prev;
      return { ...prev, [updated.lead_id]: list.map((c) => (c.id === updated.id ? updated : c)) };
    });
  }

  const leadIds = Object.keys(candidatesByLead);

  return (
    <Modal open={open} onClose={onClose} title="Find decision maker">
      <div className="flex flex-col gap-4">
        {leadIds.length === 0 && <p className="text-sm text-muted">No decision-maker candidates found for the selected leads.</p>}
        {leadIds.map((leadId) => {
          const lead = leadsById[leadId];
          const candidates = candidatesByLead[leadId] ?? [];
          return (
            <div key={leadId} className="rounded-lg border border-line p-3">
              <p className="mb-2 text-sm font-semibold">{lead?.business_name ?? leadId}</p>
              <ul className="flex flex-col gap-2">
                {candidates.map((candidate) => (
                  <li key={candidate.id} className="rounded bg-surface/60 p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase text-muted">{candidate.source}</span>
                      <span className="font-semibold">{candidateName(candidate)}</span>
                      {candidate.title && <span className="text-muted">— {candidate.title}</span>}
                    </div>
                    {candidate.source === 'hunter' && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-success">{candidate.email}</span>
                        <Button
                          variant="secondary"
                          onClick={() => void handleApplyHunter(leadId, candidate)}
                          disabled={busyId === candidate.id || appliedIds.has(candidate.id)}
                        >
                          {appliedIds.has(candidate.id) ? 'Added' : busyId === candidate.id ? 'Adding…' : 'Add to lead'}
                        </Button>
                      </div>
                    )}
                    {candidate.source === 'apollo' && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => void handleReveal(candidate, 'reveal_email')}
                          disabled={busyId === candidate.id || candidate.email_revealed}
                        >
                          {candidate.email_revealed ? candidate.email! : busyId === candidate.id ? 'Revealing…' : 'Reveal email'}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void handleReveal(candidate, 'reveal_phone')}
                          disabled={busyId === candidate.id || candidate.phone_status !== 'not_requested'}
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
            </div>
          );
        })}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
