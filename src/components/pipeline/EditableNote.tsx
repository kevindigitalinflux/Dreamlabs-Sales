import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { LeadNote } from '../../types';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Input';

/**
 * "Stage changed: X → Y" notes are the activity history the pipeline analytics
 * parse their conversion funnel from, so editing one would silently corrupt the
 * numbers. Every other note is the rep's own text and is freely editable.
 */
export function isEditableNote(note: LeadNote): boolean {
  return !note.content.startsWith('Stage changed:');
}

interface EditableNoteProps {
  note: LeadNote;
  /** Saves the new text; resolves to an error message, or null on success. */
  onSave: (noteId: string, content: string) => Promise<string | null>;
  /** Shorten long notes in compact spaces (the pipeline side card). */
  clamp?: boolean;
}

/** A note's text with an inline Edit → textarea → Save/Cancel flow. */
export function EditableNote({ note, onSave, clamp = false }: EditableNoteProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setDraft(note.content);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    const err = await onSave(note.id, draft);
    setBusy(false);
    if (err) { setError(err); return; }
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="min-w-0">
        <p className={`whitespace-pre-wrap text-sm ${clamp ? 'line-clamp-3' : ''}`}>{note.content}</p>
        {isEditableNote(note) && (
          <button
            type="button"
            onClick={startEditing}
            className="mt-1 flex min-h-8 cursor-pointer items-center gap-1 text-xs font-semibold text-cyan hover:underline"
          >
            <Pencil className="h-3 w-3" aria-hidden /> Edit note
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Textarea label="Edit note" value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} autoFocus />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={() => void save()} disabled={busy || !draft.trim() || draft.trim() === note.content.trim()} loading={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}
