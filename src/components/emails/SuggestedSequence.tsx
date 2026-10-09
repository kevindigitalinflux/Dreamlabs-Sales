import { useEffect, useRef, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { readableInvokeError } from '../../lib/invokeError';
import { supabase } from '../../lib/supabase';
import { Button } from '../ui/Button';

interface SuggestedSequenceProps {
  leadId: string;
  /** Enrols the lead at step 1. Resolves to an error message, or null on success (as useEnrollments.enroll). */
  onEnroll: (sequenceId: string) => Promise<string | null>;
}

interface Suggestion { sequence_id: string | null; sequence_name: string | null; reason: string }

type State =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'done'; suggestion: Suggestion }
  | { kind: 'error'; message: string };

/**
 * For a lead that is in no sequence: an explicit "Suggest a sequence" button (never called on open, because it
 * spends AI credits), the suggestion with its reason, and a one-click enrol. Once enrolled the parent swaps this
 * out for the sequence picker.
 */
export function SuggestedSequence({ leadId, onEnroll }: SuggestedSequenceProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const request = useRef(0);

  // A different lead invalidates any answer in flight or on screen.
  useEffect(() => {
    request.current += 1;
    setState({ kind: 'idle' }); setEnrolling(false); setEnrollError(null);
  }, [leadId]);

  async function suggest() {
    const mine = ++request.current;
    setState({ kind: 'asking' }); setEnrollError(null);
    const { data, error } = await supabase.functions.invoke('suggest-sequence', { body: { lead_id: leadId } });
    if (mine !== request.current) return;
    if (error) return setState({ kind: 'error', message: await readableInvokeError(error) });
    const s = data as Partial<Suggestion> & { error?: string } | null;
    if (!s || s.error) return setState({ kind: 'error', message: s?.error ?? 'Could not suggest a sequence right now' });
    setState({ kind: 'done', suggestion: { sequence_id: s.sequence_id ?? null, sequence_name: s.sequence_name ?? null, reason: s.reason ?? '' } });
  }

  async function enrol(sequenceId: string) {
    const mine = request.current;
    setEnrolling(true); setEnrollError(null);
    const message = await onEnroll(sequenceId);
    if (mine !== request.current) return;
    setEnrolling(false);
    if (message) setEnrollError(message);
  }

  const suggestion = state.kind === 'done' ? state.suggestion : null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      {state.kind !== 'done' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void suggest()} disabled={state.kind === 'asking'} loading={state.kind === 'asking'}>
            <Lightbulb className="h-4 w-4" aria-hidden />{state.kind === 'asking' ? 'Thinking…' : 'Suggest a sequence'}
          </Button>
          <span className="text-xs text-muted">Uses one AI call. Not in a sequence yet.</span>
        </div>
      )}
      {state.kind === 'error' && <p role="alert" className="text-sm text-danger">{state.message}</p>}
      {suggestion && suggestion.sequence_id && (
        <>
          <p className="text-sm font-semibold">Suggested: {suggestion.sequence_name}</p>
          {suggestion.reason && <p className="text-xs text-muted">{suggestion.reason}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void enrol(suggestion.sequence_id!)} disabled={enrolling} loading={enrolling}>
              {enrolling ? 'Enrolling…' : `Enrol in ${suggestion.sequence_name}`}
            </Button>
            <button type="button" onClick={() => setState({ kind: 'idle' })} className="flex min-h-11 cursor-pointer items-center text-xs text-cyan">Dismiss</button>
          </div>
        </>
      )}
      {suggestion && !suggestion.sequence_id && (
        <>
          <p className="text-sm text-muted">{suggestion.reason || 'No sequence is a clear fit for this lead'}</p>
          <button type="button" onClick={() => setState({ kind: 'idle' })} className="flex min-h-11 cursor-pointer items-center self-start text-xs text-cyan">Try again</button>
        </>
      )}
      {enrollError && <p role="alert" className="text-sm text-danger">{enrollError}</p>}
    </div>
  );
}
