import { useState } from 'react';
import type { IcpInput } from '../../hooks/useIcps';
import type { IdealCustomerProfile } from '../../types';
import { Button } from '../ui/Button';
import { ConfirmDeleteButton } from '../ui/ConfirmDeleteButton';
import { Input, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';

type TextField = Exclude<keyof IcpInput, 'name'>;

/** The profile's text fields, in the order they read best, each with guidance on what to write. */
const FIELDS: { key: TextField; label: string; hint: string; rows: number; placeholder: string }[] = [
  { key: 'summary', label: 'Who they are', rows: 3, hint: 'Roles, company size, their situation, where they work.', placeholder: 'e.g. Property managers running 20 to 200 residential units, usually small independent firms with no in-house maintenance team.' },
  { key: 'pain_points', label: 'Their pain points', rows: 5, hint: 'One per line, most important first. The first one is what {{pain_point}} falls back to when a lead has none noted.', placeholder: 'Chasing late rent payments\nSlow, unreliable contractors for repairs\nVoid periods between tenants' },
  { key: 'goals', label: 'What they want', rows: 3, hint: 'The outcomes and priorities they care about.', placeholder: 'e.g. Fewer tenant complaints, faster turnaround on repairs, a cleaner building without having to manage the cleaners.' },
  { key: 'objections', label: 'Objections they raise', rows: 3, hint: 'What they push back on, and how you answer it.', placeholder: 'e.g. "We already have someone": ask what happens when they cancel at short notice.' },
  { key: 'messaging_notes', label: 'How to talk to them', rows: 3, hint: 'Tone, words to use or avoid, which angle lands.', placeholder: 'e.g. Plain and practical, no jargon. Lead with reliability, not price.' },
  { key: 'extra_context', label: 'Anything else', rows: 4, hint: 'Buying triggers, seasonality, competitors they use, anything else that helps the email feel written for them.', placeholder: 'e.g. Busiest at end of tenancy and before inspections.' },
];

interface IcpEditorProps {
  /** null = creating a new profile. */
  profile: IdealCustomerProfile | null;
  /** Everyone can read a profile, but only org admins can change it. */
  canEdit: boolean;
  onSave: (input: IcpInput, id?: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onClose: () => void;
}

/** Modal to read or edit one ideal customer profile. Fields are disabled for non-admins. */
export function IcpEditor({ profile, canEdit, onSave, onDelete, onClose }: IcpEditorProps) {
  const [form, setForm] = useState<IcpInput>({
    name: profile?.name ?? '', summary: profile?.summary ?? '', pain_points: profile?.pain_points ?? '',
    goals: profile?.goals ?? '', objections: profile?.objections ?? '', messaging_notes: profile?.messaging_notes ?? '',
    extra_context: profile?.extra_context ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    const err = await onSave(form, profile?.id);
    setBusy(false);
    if (err) { setError(err); return; }
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={profile ? `Customer profile: ${profile.name}` : 'New customer profile'}>
      <div className="flex flex-col gap-4">
        <Input label="Name" value={form.name} disabled={!canEdit} maxLength={80}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Property managers" />
        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <Textarea label={f.label} rows={f.rows} value={form[f.key]} disabled={!canEdit} placeholder={f.placeholder}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))} />
            <p className="text-xs text-muted">{f.hint}</p>
          </div>
        ))}
        {!canEdit && <p className="text-xs text-muted">Only an org admin can edit this.</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {profile ? (
              <ConfirmDeleteButton
                label="Delete"
                question="Delete this profile?"
                onConfirm={async () => {
                  const err = await onDelete(profile.id);
                  if (!err) onClose();
                  return err;
                }}
              />
            ) : <span />}
            <Button onClick={() => void handleSave()} disabled={busy || !form.name.trim()} loading={busy}>{busy ? 'Saving…' : 'Save profile'}</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
