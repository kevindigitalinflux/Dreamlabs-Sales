import { useState } from 'react';
import { Plus } from 'lucide-react';
import { slugifyVariableKey } from '../../lib/customVariables';
import type { CustomVariableInput } from '../../hooks/useCustomVariables';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface PlaceholderAddFormProps {
  scope: CustomVariableInput['scope'];
  onAdd: (input: CustomVariableInput) => Promise<string | null>;
}

/**
 * "Add a placeholder": type a label like "Google Meet link" and the {{name}} is suggested
 * ({{google_meet_link}}); the name can still be edited until it's added.
 */
export function PlaceholderAddForm({ scope, onAdd }: PlaceholderAddFormProps) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeLabel(next: string) {
    setLabel(next);
    if (!keyEdited) setKey(slugifyVariableKey(next));
  }

  async function add() {
    setBusy(true);
    const err = await onAdd({ key, label, value, scope });
    setBusy(false);
    if (err) { setError(err); return; }
    setLabel(''); setKey(''); setValue(''); setKeyEdited(false); setError(null);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input label="Label" value={label} onChange={(e) => changeLabel(e.target.value)} placeholder="e.g. Google Meet link" />
        <Input label="Placeholder name" value={key} onChange={(e) => { setKey(slugifyVariableKey(e.target.value)); setKeyEdited(true); }} placeholder="google_meet_link" />
      </div>
      <Input label="Value (what it gets replaced with)" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://meet.google.com/…" />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => void add()} disabled={busy || !key || !value.trim()} loading={busy}>
          <Plus className="h-4 w-4" aria-hidden />{busy ? 'Adding…' : 'Add placeholder'}
        </Button>
        {key && <span className="text-xs text-muted">Use it in a template as <code>{`{{${key}}}`}</code></span>}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
