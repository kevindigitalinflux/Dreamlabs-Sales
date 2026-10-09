import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useDecisionMakers } from '../../hooks/useDecisionMakers';
import { buildFromFullName } from '../../lib/knownPersonForm';
import type { KnownPersonInput } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface FindDecisionMakerPanelProps {
  leadId: string;
  /** True while a known-person lookup is running. */
  lookingUp: boolean;
  /** Error from the last known-person lookup, if any. */
  lookupError: string | null;
  /** Runs the known-person lookup; resolves to an error message, or null when the person was saved. */
  onLookup: (person: KnownPersonInput) => Promise<string | null>;
  /** Called after the generic search so the contacts list can refresh. */
  onSearched: () => Promise<void>;
  onClose: () => void;
}

/**
 * "Find decision maker" for ONE lead. Optionally, "I already know who to look for"
 * takes a name (plus position, email, LinkedIn) and looks up just that person INSTEAD
 * of the generic search. The bulk action on the Pipeline list never shows this section:
 * `known_person` only works for a single lead.
 */
export function FindDecisionMakerPanel({ leadId, lookingUp, lookupError, onLookup, onSearched, onClose }: FindDecisionMakerPanelProps) {
  const { searching, error: searchError, runSearch } = useDecisionMakers();
  const [known, setKnown] = useState(false);
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [usePaid, setUsePaid] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const epoch = useRef(0);
  useEffect(() => { epoch.current++; }, [leadId]);

  async function submit() {
    setFormError(null); setNote(null);
    if (!known) {
      const mine = epoch.current;
      const found = await runSearch([leadId]);
      if (mine !== epoch.current || !found) return;
      await onSearched();
      setNote(`Search finished. ${found[leadId]?.length ?? 0} people found for this lead.`);
      return;
    }
    const built = buildFromFullName(fullName, { title, email, linkedin_url: linkedin }, usePaid);
    if (!built.ok) { setFormError(built.error); return; }
    if ((await onLookup(built.value)) === null) onClose();
  }

  const busy = searching || lookingUp;
  const error = formError ?? (known ? lookupError : searchError);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3" aria-label="Find decision maker">
      <button type="button" aria-expanded={known} onClick={() => setKnown((k) => !k)} className="flex cursor-pointer items-center gap-1 text-left text-sm font-semibold text-offwhite">
        {known ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        I already know who to look for
      </button>
      {known && (
        <div className="flex flex-col gap-2">
          <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Andrea Manning" autoComplete="off" />
          <p className="text-xs text-muted">The first word is the first name and the rest is the last name.</p>
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
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {note && <p role="status" className="text-sm text-success">{note}</p>}
      <div className="flex gap-2">
        <Button onClick={() => void submit()} loading={busy}>
          {busy ? 'Searching…' : known ? 'Look up this person' : 'Search for decision makers'}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
      </div>
    </div>
  );
}
