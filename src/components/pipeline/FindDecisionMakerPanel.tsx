import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useDecisionMakers } from '../../hooks/useDecisionMakers';
import { buildFromFullName, namePreview, splitFullName } from '../../lib/knownPersonForm';
import type { NameOverride } from '../../lib/knownPersonForm';
import type { DecisionMakerCandidate, KnownPersonInput } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface FindDecisionMakerPanelProps {
  leadId: string;
  /** True while a known-person lookup is running (it may have been started elsewhere). */
  lookingUp: boolean;
  /** Runs the known-person lookup; resolves to an error message, or null when the person was saved. */
  onLookup: (person: KnownPersonInput) => Promise<string | null>;
  /** Shows the generic search results and refreshes the contacts; resolves to a warning to display, or null. */
  onSearched: (found: Record<string, DecisionMakerCandidate[]>) => Promise<string | null>;
  onClose: () => void;
}

/**
 * "Find decision maker" for ONE lead. Optionally, "I already know who to look for"
 * takes a name (plus position, email, LinkedIn) and looks up just that person INSTEAD
 * of the generic search. The bulk action on the Pipeline list never shows this section:
 * `known_person` only works for a single lead. Errors here belong to this panel only.
 */
export function FindDecisionMakerPanel({ leadId, lookingUp, onLookup, onSearched, onClose }: FindDecisionMakerPanelProps) {
  const { searching, error: searchError, runSearch } = useDecisionMakers();
  const [known, setKnown] = useState(false);
  const [fullName, setFullName] = useState('');
  const [override, setOverride] = useState<NameOverride | null>(null);
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [usePaid, setUsePaid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const epoch = useRef(0);
  useEffect(() => { epoch.current++; }, [leadId]);

  function toggleEdit() {
    if (override) { setOverride(null); return; }
    const split = splitFullName(fullName);
    setOverride(split.ok ? split.value : { first_name: '', last_name: '' });
  }

  async function submit() {
    setError(null); setNote(null);
    const mine = epoch.current;
    if (!known) {
      const found = await runSearch([leadId]);
      if (mine !== epoch.current || !found) return;
      const warning = await onSearched(found);
      setNote(`Search finished. ${found[leadId]?.length ?? 0} people found for this lead.${warning ? ` ${warning}` : ''}`);
      return;
    }
    const built = buildFromFullName(fullName, { title, email, linkedin_url: linkedin }, usePaid, override);
    if (!built.ok) { setError(built.error); return; }
    setWorking(true);
    const failure = await onLookup(built.value);
    if (mine !== epoch.current) return;
    setWorking(false);
    if (failure === null) onClose(); else setError(failure);
  }

  const busy = searching || lookingUp || working;
  const shownError = known ? error : (error ?? searchError);
  const preview = namePreview(fullName);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3" aria-label="Find decision maker">
      <button type="button" aria-expanded={known} onClick={() => setKnown((k) => !k)} className="flex cursor-pointer items-center gap-1 text-left text-sm font-semibold text-offwhite">
        {known ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        I already know who to look for
      </button>
      {known && (
        <div className="flex flex-col gap-2">
          <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Andrea Manning" autoComplete="off" />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{preview ?? 'Enter the first and last name.'}</span>
            <button type="button" onClick={toggleEdit} className="cursor-pointer font-semibold text-violet underline">{override ? 'Use the split' : 'Edit'}</button>
          </div>
          {override && (
            <div className="grid grid-cols-2 gap-2">
              <Input label="First name" value={override.first_name} onChange={(e) => setOverride({ ...override, first_name: e.target.value })} autoComplete="off" />
              <Input label="Last name" value={override.last_name} onChange={(e) => setOverride({ ...override, last_name: e.target.value })} autoComplete="off" />
            </div>
          )}
          <p className="text-xs text-muted">Check the last name: Hunter and Apollo match people on it.</p>
          <Input label="Position (optional)" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
          <Input label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          <Input label="LinkedIn URL (optional)" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://" autoComplete="off" />
          <label className="flex items-center gap-2 text-sm text-offwhite">
            <input type="checkbox" checked={usePaid} onChange={(e) => setUsePaid(e.target.checked)} className="h-4 w-4 accent-violet-500" />
            Use paid lookups (Hunter / Apollo)
          </label>
          <p className="text-xs text-muted">May use one Hunter and one Apollo credit.</p>
        </div>
      )}
      {shownError && <p role="alert" className="text-sm text-danger">{shownError}</p>}
      {note && <p className="text-sm text-success">{note}</p>}
      <div className="flex gap-2">
        <Button onClick={() => void submit()} loading={busy}>
          {busy ? 'Searching…' : known ? 'Look up this person' : 'Search for decision makers'}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
      </div>
    </div>
  );
}
