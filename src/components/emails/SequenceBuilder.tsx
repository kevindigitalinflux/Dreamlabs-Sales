import { useState } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { timelineLabel } from '../../lib/sequenceMath';
import { useTemplates } from '../../hooks/useTemplates';
import type { SequenceInput } from '../../hooks/useSequences';
import { stepFieldsFromValue, stepTemplateValue } from '../../lib/sequenceSteps';
import type { EmailSequence, SequenceStep } from '../../types';
import { Button } from '../ui/Button';
import { Input, SelectField } from '../ui/Input';
import { Modal } from '../ui/Modal';

interface SequenceBuilderProps {
  sequence: EmailSequence | null;
  isAdmin: boolean;
  onSave: (input: SequenceInput, id?: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onClose: () => void;
}

interface TemplateOption { value: string; label: string }

function StepCard({ index, step, standard, custom, onChange, onRemove }: {
  index: number;
  step: SequenceStep;
  /** Built-in kinds (initial follow-up, second chase…), referenced by type. */
  standard: TemplateOption[];
  /** The user's own templates, referenced by id. */
  custom: TemplateOption[];
  onChange: (patch: Partial<SequenceStep>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: `step-${index}` });
  const current = stepTemplateValue(step);
  // A step can point at a template that has since been deleted; keep it visible rather than blank.
  const missing = ![...standard, ...custom].some((o) => o.value === current);
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex min-w-0 items-end gap-2 rounded-lg border border-line bg-surface/40 p-3">
      <button type="button" {...attributes} {...listeners} aria-label="Reorder step" className="mb-1 flex h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted hover:bg-surface"><GripVertical className="h-4 w-4" aria-hidden /></button>
      {/* shrink-0 keeps the days box a fixed, readable width however long the template name is. */}
      <div className="w-24 shrink-0">
        <Input label={index === 0 ? 'Start after (days)' : 'Wait (days)'} type="number" min="0" value={String(step.delay_days)}
          onChange={(e) => onChange({ delay_days: Math.max(0, Number(e.target.value) || 0) })} />
      </div>
      {/* min-w-0 lets this column shrink below its content so a long template name is truncated
          inside the card instead of stretching it. */}
      <div className="min-w-0 flex-1">
        <SelectField label="Template" value={current} onChange={(e) => onChange(stepFieldsFromValue(e.target.value))}>
          <optgroup label="Standard templates">
            {standard.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
          {custom.length > 0 && (
            <optgroup label="Your templates">
              {custom.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          )}
          {missing && <option value={current}>(template no longer available)</option>}
        </SelectField>
      </div>
      <button type="button" onClick={onRemove} aria-label="Remove step" className="mb-1 flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-danger"><Trash2 className="h-4 w-4" aria-hidden /></button>
    </li>
  );
}

/** Sequence builder: named steps with day delays, drag-reorder, timeline preview. */
export function SequenceBuilder({ sequence, isAdmin, onSave, onDelete, onClose }: SequenceBuilderProps) {
  const { templates } = useTemplates();
  const standardOptions: TemplateOption[] = templates.filter((t) => t.is_default && t.template_type !== 'custom')
    .map((t) => ({ value: `type:${t.template_type}`, label: t.name }));
  // Templates created in Emails, Templates all have the generic type 'custom', so a step
  // has to point at them by id; they were missing from this list entirely before.
  const customOptions: TemplateOption[] = templates.filter((t) => t.template_type === 'custom')
    .map((t) => ({ value: `id:${t.id}`, label: t.name }));
  const [form, setForm] = useState<SequenceInput>({
    name: sequence?.name ?? '', description: sequence?.description ?? null,
    steps: sequence?.steps ?? [], is_default: sequence?.is_default ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setStep(i: number, patch: Partial<SequenceStep>) {
    setForm((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  }
  function addStep() {
    setForm((f) => ({ ...f, steps: [...f.steps, { delay_days: f.steps.length === 0 ? 0 : 2, template_type: 'initial_followup', subject_override: null }] }));
  }
  function handleDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = Number(String(e.active.id).replace('step-', ''));
    const to = Number(String(e.over.id).replace('step-', ''));
    setForm((f) => ({ ...f, steps: arrayMove(f.steps, from, to) }));
  }
  async function handleSave() {
    if (!form.name.trim()) return setError('Give the sequence a name.');
    if (form.steps.length === 0) return setError('Add at least one step.');
    setBusy(true);
    const err = await onSave(form, sequence?.id);
    setBusy(false);
    if (err) return setError(err);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={sequence ? `Edit — ${sequence.name}` : 'New sequence'}>
      <div className="flex flex-col gap-4">
        <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Input label="Description (optional)" value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value || null }))} />
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={form.steps.map((_, i) => `step-${i}`)} strategy={verticalListSortingStrategy}>
            <ol className="flex flex-col gap-2">
              {form.steps.map((s, i) => (
                <StepCard key={`step-${i}`} index={i} step={s} standard={standardOptions} custom={customOptions}
                  onChange={(patch) => setStep(i, patch)}
                  onRemove={() => setForm((f) => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        <Button variant="secondary" onClick={addStep}><Plus className="h-4 w-4" aria-hidden />Add step</Button>
        <p className="rounded-lg bg-surface/60 p-3 text-sm font-semibold text-cyan">{timelineLabel(form.steps)}</p>
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))} className="h-4 w-4 accent-violet-500" />
            Default sequence (visible to all contractors)
          </label>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex items-center justify-between">
          {sequence && !sequence.is_default ? <Button variant="ghost" onClick={() => { setBusy(true); void onDelete(sequence.id).then((err) => { setBusy(false); if (err) setError(err); else onClose(); }); }} disabled={busy} loading={busy}>Delete</Button> : <span />}
          <Button onClick={() => void handleSave()} disabled={busy} loading={busy}>{busy ? 'Saving…' : 'Save sequence'}</Button>
        </div>
      </div>
    </Modal>
  );
}
