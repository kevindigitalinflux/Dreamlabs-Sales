import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { LeadPatch } from '../../lib/leadUpdates';
import type { Lead, LeadSuggestion, NoteType } from '../../types';
import { Button } from '../ui/Button';
import { Input, SelectField, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { DebriefWizard } from './DebriefWizard';
import { sanitizeSuggestion, SuggestionDiff } from './SuggestionDiff';

interface NoteComposerProps {
  open: boolean;
  onClose: () => void;
  lead: Lead;
  addNote: (content: string, noteType: NoteType) => Promise<string | null>;
  onUpdateLead: (patch: LeadPatch) => Promise<string | null>;
}

type Phase = 'compose' | 'next-action' | 'suggest';

/** Log-note dialog: guided debrief OR free text, then a "set your next action" prompt. */
export function NoteComposer({ open, onClose, lead, addNote, onUpdateLead }: NoteComposerProps) {
  const [tab, setTab] = useState<'debrief' | 'free'>('debrief');
  const [phase, setPhase] = useState<Phase>('compose');
  const [freeText, setFreeText] = useState('');
  const [noteType, setNoteType] = useState<NoteType>('call');
  const [nextDate, setNextDate] = useState('');
  const [nextNote, setNextNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiParse, setAiParse] = useState(true);
  const [suggestion, setSuggestion] = useState<LeadSuggestion | null>(null);

  function reset() {
    setTab('debrief');
    setPhase('compose');
    setFreeText('');
    setNoteType('call');
    setNextDate('');
    setNextNote('');
    setError(null);
    setSuggestion(null);
    onClose();
  }

  /** Calls parse-notes when the toggle is on; falls through to a clean reset on any failure or empty result — never blocks the note flow. */
  async function maybeSuggest(noteText: string) {
    if (!aiParse) return reset();
    setBusy(true);
    const { data } = await supabase.functions.invoke('parse-notes', { body: { lead_id: lead.id, note: noteText } });
    setBusy(false);
    const raw = (data as { suggestion?: unknown } | null)?.suggestion;
    const clean = raw ? sanitizeSuggestion(raw) : null;
    if (clean) {
      setSuggestion(clean);
      setPhase('suggest');
    } else {
      reset();
    }
  }

  async function saveDebrief(compiled: string, nextAction: { date: string | null; note: string | null }) {
    setBusy(true);
    const err = await addNote(compiled, 'call');
    if (!err && (nextAction.date || nextAction.note)) {
      await onUpdateLead({ next_action_date: nextAction.date, next_action_note: nextAction.note });
    }
    setBusy(false);
    if (err) setError(err);
    else void maybeSuggest(compiled);
  }

  async function saveFreeText() {
    if (!freeText.trim()) return setError('Write a note first.');
    setBusy(true);
    const err = await addNote(freeText.trim(), noteType);
    setBusy(false);
    if (err) return setError(err);
    setNextDate(lead.next_action_date ?? '');
    setNextNote(lead.next_action_note ?? '');
    setPhase('next-action');
  }

  async function saveNextAction() {
    setBusy(true);
    const err = await onUpdateLead({ next_action_date: nextDate || null, next_action_note: nextNote || null });
    setBusy(false);
    if (err) setError(err);
    else void maybeSuggest(freeText);
  }

  const title = phase === 'compose' ? `Log note — ${lead.business_name}` : phase === 'suggest' ? 'AI suggestions' : 'Set your next action';

  return (
    <Modal open={open} onClose={reset} title={title}>
      {phase === 'suggest' && suggestion ? (
        <SuggestionDiff
          lead={lead}
          suggestion={suggestion}
          onApply={(patch) => { void onUpdateLead(patch).then(() => reset()); }}
          onDismiss={reset}
        />
      ) : phase === 'compose' ? (
        <div className="flex flex-col gap-4">
          <div className="flex overflow-hidden rounded-lg border border-line" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'debrief'} onClick={() => setTab('debrief')} className={`min-h-11 flex-1 cursor-pointer text-sm font-semibold ${tab === 'debrief' ? 'bg-violet/25' : 'text-muted'}`}>
              Quick debrief
            </button>
            <button type="button" role="tab" aria-selected={tab === 'free'} onClick={() => setTab('free')} className={`min-h-11 flex-1 cursor-pointer text-sm font-semibold ${tab === 'free' ? 'bg-violet/25' : 'text-muted'}`}>
              Free text
            </button>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={aiParse} onChange={(e) => setAiParse(e.target.checked)} className="h-4 w-4 accent-violet-500" />
            Let AI suggest lead updates from this note
          </label>

          {tab === 'debrief' && <DebriefWizard onSubmit={(c, n) => void saveDebrief(c, n)} onCancel={reset} />}
          {tab === 'free' && (
            <div className="flex flex-col gap-4">
              <Textarea label="Session notes" value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder="Paste or type your notes here." rows={6} />
              <SelectField label="Note type" value={noteType} onChange={(e) => setNoteType(e.target.value as NoteType)}>
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="meeting">Meeting</option>
                <option value="general">General</option>
              </SelectField>
              {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
              <Button onClick={() => void saveFreeText()} disabled={busy}>{busy ? 'Saving…' : 'Save note'}</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">Note saved ✓ — before you close, when should you touch this lead next?</p>
          <Input label="Next action date" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          <Input label="Next action note" value={nextNote} onChange={(e) => setNextNote(e.target.value)} placeholder="e.g. Chase by phone" />
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={reset}>Skip</Button>
            <Button onClick={() => void saveNextAction()} disabled={busy}>{busy ? 'Saving…' : 'Save next action'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
