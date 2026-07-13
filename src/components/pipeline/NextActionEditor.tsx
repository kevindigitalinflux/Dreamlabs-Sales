import { useEffect, useState } from 'react';
import type { Lead } from '../../types';
import { Input } from '../ui/Input';

interface NextActionEditorProps {
  lead: Lead;
  onSave: (patch: { next_action_date: string | null; next_action_note: string | null }) => Promise<string | null>;
}

/** Inline next-action editor: date + note, saves on blur with a subtle status indicator. */
export function NextActionEditor({ lead, onSave }: NextActionEditorProps) {
  const [date, setDate] = useState(lead.next_action_date ?? '');
  const [note, setNote] = useState(lead.next_action_note ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setDate(lead.next_action_date ?? '');
    setNote(lead.next_action_note ?? '');
    setStatus('idle');
  }, [lead.id, lead.next_action_date, lead.next_action_note]);

  async function save() {
    if (date === (lead.next_action_date ?? '') && note === (lead.next_action_note ?? '')) return;
    setStatus('saving');
    const err = await onSave({ next_action_date: date || null, next_action_note: note || null });
    setStatus(err ? 'error' : 'saved');
  }

  return (
    <div className="flex flex-col gap-3">
      <Input label="Next action date" type="date" value={date} onChange={(e) => setDate(e.target.value)} onBlur={() => void save()} />
      <Input label="Next action note" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => void save()} placeholder="e.g. Chase proposal by phone" />
      <p aria-live="polite" className="min-h-5 text-xs text-muted">
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && 'Saved ✓'}
        {status === 'error' && <span className="text-red-400">Could not save — check your connection.</span>}
      </p>
    </div>
  );
}
