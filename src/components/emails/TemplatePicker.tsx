import { useEffect, useMemo, useRef, useState } from 'react';
import { buildDefaultTemplateIdByType } from '../../../supabase/functions/_shared/postSendRules';
import { pickerOptions } from '../../lib/templatePicker';
import type { EmailSequence, EmailTemplate, SequenceEnrollment } from '../../types';
import { categorisedOptions } from '../ui/CategorisedOptions';
import { SelectField } from '../ui/Input';

interface TemplatePickerProps {
  templates: EmailTemplate[];
  sequences: EmailSequence[];
  /** The lead's active or paused enrolment, if any. */
  enrollment: SequenceEnrollment | null;
  orgId: string | undefined;
  loading: boolean;
  error: string | null;
  value: string;
  onChange: (templateId: string) => void;
  /** False when the caller already has a draft or template in hand: never pre-select over it. */
  autoSelect: boolean;
}

/**
 * The composer's template list. For a lead following a sequence it shows "Following X (step N of M)", lists that
 * sequence's templates in step order, pre-selects the current step's template (only while nothing is chosen) and
 * offers "Show all templates". Otherwise it is the usual category-grouped list of every template.
 */
export function TemplatePicker({ templates, sequences, enrollment, orgId, loading, error, value, onChange, autoSelect }: TemplatePickerProps) {
  const [showAll, setShowAll] = useState(false);
  const preselected = useRef<string | null>(null);
  const picker = useMemo(() => pickerOptions({
    templates, sequences, enrollment, showAll,
    defaultTemplateIdByType: buildDefaultTemplateIdByType(
      templates.map((t) => ({ id: t.id, org_id: (t as { org_id?: string | null }).org_id ?? null, template_type: t.template_type, is_default: t.is_default })),
      orgId ?? '',
    ),
  }), [templates, sequences, enrollment, showAll, orgId]);

  // Pre-select the current step's template once per step, and only while the caller has nothing chosen.
  const key = picker.selectedId ? `${enrollment?.id ?? ''}:${picker.currentStep}:${picker.selectedId}` : null;
  useEffect(() => {
    if (!autoSelect || loading || !picker.selectedId || value !== '' || key === preselected.current) return;
    preselected.current = key;
    onChange(picker.selectedId);
  }, [autoSelect, loading, picker.selectedId, value, key, onChange]);

  if (loading) return <p role="status" className="text-sm text-muted">Loading templates…</p>;
  if (error) return <p role="alert" className="text-sm text-danger">Could not load templates: {error}</p>;
  if (templates.length === 0) return <p className="text-sm text-muted">No templates yet. Add one in Emails, Templates.</p>;

  const inSequence = picker.sequenceName !== null;
  const asOptions = (group: 'sequence' | 'other') => picker.options.filter((o) => o.group === group)
    .map((o) => <option key={o.id} value={o.id} disabled={o.disabled}>{o.label}</option>);
  return (
    <div className="flex flex-col gap-1.5">
      {inSequence && (
        <p className="text-xs font-semibold text-violet">Following {picker.sequenceName} (step {picker.currentStep} of {picker.totalSteps})</p>
      )}
      <SelectField label="Template" value={value} onChange={(e) => onChange(e.target.value)} showGroupInValue={!inSequence}>
        <option value="">Choose…</option>
        {inSequence ? [
          <optgroup key="seq" label={picker.sequenceName ?? ''}>{asOptions('sequence')}</optgroup>,
          ...(showAll ? [<optgroup key="other" label="Other templates">{asOptions('other')}</optgroup>] : []),
        ] : categorisedOptions(templates, (t) => ({ value: t.id }))}
      </SelectField>
      {inSequence && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="flex min-h-11 cursor-pointer items-center self-start text-xs text-cyan">
          {showAll ? 'Show only this sequence' : 'Show all templates'}
        </button>
      )}
    </div>
  );
}
