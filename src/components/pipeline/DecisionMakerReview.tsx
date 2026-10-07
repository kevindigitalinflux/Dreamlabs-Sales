import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { DecisionMakerCandidate, Lead } from '../../types';
import { readableInvokeError } from '../../lib/invokeError';
import { additionsFor, additionsPatchFor, alreadyOnLead, candidateName } from '../../lib/decisionMakerAdditions';
import { candidateSourceLabel, hasNoContactDetails, isRegistrySource } from '../../lib/candidateSource';
import { dismissDecisionMaker } from '../../lib/dismissDecisionMaker';
import { ConfirmDeleteButton } from '../ui/ConfirmDeleteButton';
import type { LeadPatch } from '../../lib/leadUpdates';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface DecisionMakerReviewProps {
  open: boolean;
  resultsByLead: Record<string, DecisionMakerCandidate[]>;
  leadsById: Record<string, Lead>;
  onClose: () => void;
  /** Saves found decision-makers into a lead's additional fields; resolves to an error message or null. */
  onAddToLead: (leadId: string, patch: LeadPatch) => Promise<string | null>;
}

/**
 * Review UI for the "Find decision maker" bulk-search action -- a summary
 * of what turned up across the selected leads, for when you don't want to
 * visit each lead's own detail page. Every candidate found is already
 * persistent on its lead (see DecisionMakersCard) -- there is no "add to
 * lead" action here anymore, only Apollo's explicit, already-consented
 * "Reveal email"/"Reveal phone" (Hunter candidates arrive already
 * revealed). Subscribes to realtime updates on the visible candidate rows
 * so a phone number appears the moment Apollo's webhook lands, with no
 * polling.
 */
export function DecisionMakerReview({ open, resultsByLead, leadsById, onClose, onAddToLead }: DecisionMakerReviewProps) {
  const [candidatesByLead, setCandidatesByLead] = useState<Record<string, DecisionMakerCandidate[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorByCandidate, setErrorByCandidate] = useState<Record<string, string>>({});
  const [addingAll, setAddingAll] = useState(false);
  const [addSummary, setAddSummary] = useState<string | null>(null);

  useEffect(() => {
    setCandidatesByLead(resultsByLead);
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
          // Dismissed elsewhere: drop it from this list too.
          if (updated.dismissed_at) return { ...prev, [updated.lead_id]: list.filter((c) => c.id !== updated.id) };
          return { ...prev, [updated.lead_id]: list.map((c) => (c.id === updated.id ? updated : c)) };
        });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsByLead]);

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

  /** Adds one person's known name/email/phone to their lead's additional fields, right from the results. */
  async function handleAddOne(candidate: DecisionMakerCandidate) {
    const lead = leadsById[candidate.lead_id];
    const patch = lead ? additionsPatchFor(lead, [candidate]) : null;
    if (!patch) return;
    setBusyId(candidate.id);
    const err = await onAddToLead(candidate.lead_id, patch);
    setBusyId(null);
    setErrorByCandidate((prev) => {
      const next = { ...prev };
      if (err) next[candidate.id] = err; else delete next[candidate.id];
      return next;
    });
  }

  // Leads that still have someone worth adding (e.g. an unrevealed Apollo contact has nothing yet).
  const addableLeadIds = leadIds.filter((id) => {
    const lead = leadsById[id];
    return lead && additionsPatchFor(lead, candidatesByLead[id] ?? []) !== null;
  });

  /** One click: add every found decision-maker's known details to all the searched leads. */
  async function handleAddAll() {
    setAddingAll(true);
    setAddSummary(null);
    let leadsUpdated = 0;
    let failed = 0;
    for (const id of addableLeadIds) {
      const patch = additionsPatchFor(leadsById[id]!, candidatesByLead[id] ?? []);
      if (!patch) continue;
      const err = await onAddToLead(id, patch);
      if (err) failed++; else leadsUpdated++;
    }
    setAddingAll(false);
    setAddSummary(failed === 0 ? `Added to ${leadsUpdated} ${leadsUpdated === 1 ? 'lead' : 'leads'}` : `Added to ${leadsUpdated}, ${failed} failed`);
  }

  return (
    <Modal open={open} onClose={onClose} title="Find decision maker">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted">Full contact list for each lead is on its own Decision Makers section.</p>
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
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase text-muted">{candidateSourceLabel(candidate.source)}</span>
                      <span className="font-semibold">{candidateName(candidate)}</span>
                      {candidate.title && <span className="text-muted">— {candidate.title}</span>}
                    </div>
                    {candidate.source === 'hunter' && (
                      <p className="mt-1 text-success">{candidate.email}</p>
                    )}
                    {isRegistrySource(candidate.source) && hasNoContactDetails(candidate) && (
                      <p className="mt-1 text-xs text-muted">No contact details found yet.</p>
                    )}
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
                    {(() => {
                      const lead = leadsById[candidate.lead_id];
                      const additions = additionsFor(candidate);
                      if (!lead || additions.length === 0) return null;
                      const added = alreadyOnLead(lead, additions);
                      return (
                        <div className="mt-1">
                          <Button variant="secondary" onClick={() => void handleAddOne(candidate)} disabled={added || busyId === candidate.id || addingAll} loading={busyId === candidate.id}>
                            {added ? 'Added to lead ✓' : 'Add to lead'}
                          </Button>
                        </div>
                      );
                    })()}
                    <div className="mt-1">
                      <ConfirmDeleteButton
                        label="Remove"
                        question="Remove this person?"
                        onConfirm={async () => {
                          const err = await dismissDecisionMaker(candidate.id);
                          if (!err) setCandidatesByLead((prev) => ({ ...prev, [candidate.lead_id]: (prev[candidate.lead_id] ?? []).filter((c) => c.id !== candidate.id) }));
                          return err;
                        }}
                      />
                    </div>
                    {errorByCandidate[candidate.id] && <p role="alert" className="mt-1 text-xs text-danger">{errorByCandidate[candidate.id]}</p>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {addSummary && <p role="status" className="text-sm text-success">{addSummary}</p>}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {leadIds.length > 0 && (
            <Button onClick={() => void handleAddAll()} disabled={addableLeadIds.length === 0 || addingAll} loading={addingAll}>
              {addingAll ? 'Adding…' : addableLeadIds.length === 0 ? 'Everything added' : `Add all to leads (${addableLeadIds.length})`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
