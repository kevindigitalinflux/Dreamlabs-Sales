import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { validateContactForm } from '../../lib/leadContacts';
import type { ContactFormValues } from '../../lib/leadContacts';
import type { ContactResult } from '../../hooks/useLeadContacts';

interface ContactFormProps {
  /** Starting values; their `kind` decides which fields show (person or general inbox). */
  initial: ContactFormValues;
  submitLabel: string;
  /** Saves the form; resolves to an error to show inline, or no error to close the form. */
  onSubmit: (form: ContactFormValues) => Promise<ContactResult>;
  /** The LinkedIn link already stored, so leaving it untouched never fails the https rule. */
  storedLinkedin?: string | null;
  onCancel: () => void;
}

/**
 * Add / edit form for one contact. Validates with the shared contact rules before
 * calling `onSubmit` and shows the first problem inline, in plain English.
 */
export function ContactForm({ initial, submitLabel, onSubmit, onCancel, storedLinkedin }: ContactFormProps) {
  const [form, setForm] = useState<ContactFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isPerson = form.kind === 'person';
  const set = (key: keyof ContactFormValues) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const check = validateContactForm(form, storedLinkedin);
    if (!check.ok) { setError(check.error); return; }
    setBusy(true);
    const result = await onSubmit(form);
    setBusy(false);
    if (result.error) setError(result.error); else onCancel();
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3" aria-label={submitLabel}>
      {isPerson ? (
        <div className="grid grid-cols-2 gap-2">
          <Input label="First name" value={form.first_name} onChange={set('first_name')} autoComplete="off" />
          <Input label="Last name" value={form.last_name} onChange={set('last_name')} autoComplete="off" />
        </div>
      ) : (
        <Input label="Label (for example Accounts)" value={form.label} onChange={set('label')} autoComplete="off" />
      )}
      {isPerson && <Input label="Position" value={form.title} onChange={set('title')} autoComplete="off" />}
      <Input label="Email" type="email" value={form.email} onChange={set('email')} autoComplete="off" />
      <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} autoComplete="off" />
      {isPerson && <Input label="LinkedIn link" value={form.linkedin_url} onChange={set('linkedin_url')} placeholder="https://" autoComplete="off" />}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>{busy ? 'Saving…' : submitLabel}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}
