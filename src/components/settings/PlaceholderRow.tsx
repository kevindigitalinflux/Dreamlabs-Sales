import { useState } from 'react';
import type { CustomVariable } from '../../hooks/useCustomVariables';
import { Button } from '../ui/Button';
import { ConfirmDeleteButton } from '../ui/ConfirmDeleteButton';
import { Input } from '../ui/Input';

interface PlaceholderRowProps {
  variable: CustomVariable;
  canEdit: boolean;
  onUpdate: (id: string, patch: { label: string; value: string }) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
}

/** One placeholder: its {{name}}, an editable label and value, and delete. A name can't change once created, so templates using it keep working. */
export function PlaceholderRow({ variable, canEdit, onUpdate, onDelete }: PlaceholderRowProps) {
  const [label, setLabel] = useState(variable.label ?? '');
  const [value, setValue] = useState(variable.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = label.trim() !== (variable.label ?? '') || value.trim() !== variable.value;

  async function save() {
    setBusy(true);
    const err = await onUpdate(variable.id, { label, value });
    setBusy(false);
    setError(err);
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface/40 p-3">
      <code className="w-fit rounded bg-violet/20 px-2 py-0.5 text-sm font-semibold">{`{{${variable.key}}}`}</code>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input label="Label" value={label} disabled={!canEdit} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Google Meet link" />
        <Input label="Value" value={value} disabled={!canEdit} onChange={(e) => setValue(e.target.value)} placeholder="https://meet.google.com/…" />
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ConfirmDeleteButton label="Delete" question="Delete this placeholder?" onConfirm={() => onDelete(variable.id)} />
          <Button variant="secondary" onClick={() => void save()} disabled={busy || !changed || !value.trim()} loading={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </li>
  );
}
