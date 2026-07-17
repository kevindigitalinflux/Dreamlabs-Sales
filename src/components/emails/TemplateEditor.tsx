import { useRef, useState } from 'react';
import { substituteVariables, TEMPLATE_VARIABLES } from '../../lib/templateVars';
import type { TemplateInput } from '../../hooks/useTemplates';
import type { EmailTemplate } from '../../types';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';

const SAMPLE_VARS: Record<string, string> = {
  first_name: 'Ana', business_name: 'Shiny Cleaners', owner_name: 'Ana Diaz',
  audit_date: 'Tuesday 22 July, 10:00', package_name: 'Automation Sprint',
  deal_value: '£4,500', contractor_name: 'Kevin', pain_point: 'missed after-hours calls',
  cal_link: 'https://cal.com/dreamlabs/audit',
};

interface TemplateEditorProps {
  template: EmailTemplate | null;
  isAdmin: boolean;
  onSave: (input: TemplateInput, id?: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onClose: () => void;
}

/** Modal template editor with variable-insert buttons + live sample preview. */
export function TemplateEditor({ template, isAdmin, onSave, onDelete, onClose }: TemplateEditorProps) {
  const [form, setForm] = useState<TemplateInput>({
    name: template?.name ?? '', subject: template?.subject ?? '',
    body: template?.body ?? '', is_default: template?.is_default ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function insertVar(key: string) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return setForm((f) => ({ ...f, body: f.body + token }));
    const pos = el.selectionStart ?? form.body.length;
    setForm((f) => ({ ...f, body: f.body.slice(0, pos) + token + f.body.slice(pos) }));
  }

  async function handleSave() {
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) return setError('Name, subject and body are all required.');
    setBusy(true);
    const err = await onSave(form, template?.id);
    setBusy(false);
    if (err) return setError(err);
    onClose();
  }
  async function handleDelete() {
    if (!template) return;
    setBusy(true);
    const err = await onDelete(template.id);
    setBusy(false);
    if (err) return setError(err);
    onClose();
  }

  const preview = substituteVariables(form.body, SAMPLE_VARS).text;

  return (
    <Modal open onClose={onClose} title={template ? `Edit — ${template.name}` : 'New template'}>
      <div className="flex flex-col gap-4">
        <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Input label="Subject" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
        <div className="flex flex-wrap gap-1">
          {TEMPLATE_VARIABLES.map((v) => (
            <button key={v.key} type="button" onClick={() => insertVar(v.key)}
              className="min-h-11 cursor-pointer rounded-md border border-line px-3 text-xs text-muted hover:border-cyan hover:text-cyan">
              {v.label}
            </button>
          ))}
        </div>
        <Textarea ref={bodyRef} label="Body" rows={8} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))} className="h-4 w-4 accent-violet-500" />
            Default template (visible to all contractors)
          </label>
        )}
        <div className="rounded-lg bg-surface/60 p-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Preview (sample lead)</p>
          <p className="whitespace-pre-wrap text-sm">{preview}</p>
        </div>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center justify-between">
          {template && !template.is_default ? (
            <Button variant="ghost" onClick={() => void handleDelete()} disabled={busy}>Delete</Button>
          ) : <span />}
          <Button onClick={() => void handleSave()} disabled={busy}>{busy ? 'Saving…' : 'Save template'}</Button>
        </div>
      </div>
    </Modal>
  );
}
