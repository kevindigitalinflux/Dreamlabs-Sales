import { useRef, useState } from 'react';
import { substituteVariables, TEMPLATE_VARIABLES } from '../../lib/templateVars';
import { linksBlock } from '../../lib/emailAttachments';
import { useOrg } from '../../hooks/useOrg';
import { useCategories } from '../../hooks/useCategories';
import { useIcps } from '../../hooks/useIcps';
import { useCustomVariables } from '../../hooks/useCustomVariables';
import { IcpSelect } from './IcpSelect';
import { normalizeCategory } from '../../lib/categories';
import { CategoryField } from './CategoryControls';
import type { TemplateInput } from '../../hooks/useTemplates';
import type { EmailTemplate } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { AttachmentFiles } from './AttachmentFiles';
import { LinksEditor } from './LinksEditor';
import { EmailTextEditor } from './EmailTextEditor';
import { EmailPreviewPane } from './EmailPreviewPane';
import { Collapsible } from '../ui/Collapsible';
import { Paperclip } from 'lucide-react';

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
  onDuplicate?: () => Promise<string | null>;
}

/** Modal template editor with variable-insert buttons + live sample preview. */
export function TemplateEditor({ template, isAdmin, onSave, onDelete, onClose, onDuplicate }: TemplateEditorProps) {
  const { currentOrg } = useOrg();
  const [form, setForm] = useState<TemplateInput>({
    name: template?.name ?? '', subject: template?.subject ?? '',
    body: template?.body ?? '', is_default: template?.is_default ?? false,
    attachments: template?.attachments ?? [], links: template?.links ?? [],
    category: template?.category ?? '', icp_id: template?.icp_id ?? null,
  });
  const { icps } = useIcps();
  const { personal, companyWide, values: customValues } = useCustomVariables();
  // Distinct names, personal ones first: the buttons offer what this user can actually fill.
  const customKeys = [...new Set([...personal, ...companyWide].map((v) => v.key))];
  const categorySuggestions = useCategories();
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
    const err = await onSave({ ...form, category: normalizeCategory(form.category) }, template?.id);
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

  const vars = { ...SAMPLE_VARS, ...customValues };
  const preview = substituteVariables(form.body, vars).text;
  const previewSubject = substituteVariables(form.subject, vars).text;
  const attachCount = form.attachments.length + form.links.length;

  const footer = (
    <div className="flex flex-col gap-2">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {template && !template.is_default && <Button variant="ghost" onClick={() => void handleDelete()} disabled={busy}>Delete</Button>}
          {template && onDuplicate && <Button variant="secondary" disabled={busy} onClick={async () => {
            setBusy(true);
            try { const problem = await onDuplicate(); if (problem) setError(problem); }
            catch (error) { console.error('Could not duplicate template', { templateId: template.id, error }); setError('Could not duplicate template. Check the list before trying again.'); }
            finally { setBusy(false); }
          }}>Duplicate</Button>}
        </div>
        <Button onClick={() => void handleSave()} disabled={busy} loading={busy}>{busy ? 'Saving…' : 'Save template'}</Button>
      </div>
    </div>
  );

  return (
    <Modal open onClose={onClose} size="wide" footer={footer} title={template ? `Edit — ${template.name}` : 'New template'}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <CategoryField value={form.category ?? ''} onChange={(category) => setForm((f) => ({ ...f, category }))} suggestions={categorySuggestions} />
          </div>
          <IcpSelect
            icps={icps}
            value={form.icp_id}
            onChange={(icp_id) => setForm((f) => ({ ...f, icp_id }))}
            hint="Who this template is written for. {{pain_point}} uses their top pain point when a lead has none noted, and the AI is given the whole profile so the email resonates."
          />
          <Input label="Subject" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted">Insert a placeholder</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button key={v.key} type="button" onClick={() => insertVar(v.key)}
                  className="min-h-8 cursor-pointer rounded-full border border-line bg-raised px-3 text-[13px] font-medium text-muted hover:border-violet-line hover:text-link focus-visible:outline-2 focus-visible:outline-focus">
                  {v.label}
                </button>
              ))}
              {customKeys.map((key) => (
                <button key={key} type="button" onClick={() => insertVar(key)} title={`Your value: ${customValues[key] ?? ''}`}
                  className="min-h-8 cursor-pointer rounded-full border border-violet-line bg-violet/10 px-3 text-[13px] font-medium text-link hover:bg-violet/20 focus-visible:outline-2 focus-visible:outline-focus">
                  {`{{${key}}}`}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">Need another, like a meeting link? Add your own in Settings, Custom placeholders.</p>
          </div>
          <EmailTextEditor ref={bodyRef} label="Body" rows={10} value={form.body} onChange={(body) => setForm((f) => ({ ...f, body }))} showPreview={false} />
          {currentOrg && (
            <Collapsible flat icon={Paperclip} title="Attachments and links" summary={attachCount > 0 ? `${attachCount} added` : 'None yet'}>
              <div className="flex flex-col gap-4">
                <AttachmentFiles orgId={currentOrg.id} attachments={form.attachments} onChange={(attachments) => setForm((f) => ({ ...f, attachments }))} />
                <LinksEditor orgId={currentOrg.id} links={form.links} onChange={(links) => setForm((f) => ({ ...f, links }))} />
              </div>
            </Collapsible>
          )}
          {isAdmin && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))} className="h-4 w-4 accent-violet-500" />
              Default template (visible to all contractors)
            </label>
          )}
        </div>
        <EmailPreviewPane
          to="Ana Diaz, Shiny Cleaners"
          caption="with a sample lead"
          subject={previewSubject}
          body={preview}
          linksText={form.links.length > 0 ? linksBlock(form.links) : undefined}
          attachmentNames={form.attachments.map((a) => a.name)}
        />
      </div>
    </Modal>
  );
}
