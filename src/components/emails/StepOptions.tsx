import { useTemplates } from '../../hooks/useTemplates';
import type { EmailTemplate, SequenceStep } from '../../types';

function templateName(step: SequenceStep, templates: EmailTemplate[]): string {
  const t = step.template_id
    ? templates.find((x) => x.id === step.template_id)
    : templates.find((x) => x.is_default && x.template_type === step.template_type);
  return t?.name ?? step.template_type.replace(/_/g, ' ');
}

/**
 * One <option> per sequence step ("Step 2 · Second chase · after 3 days"), for a "which step"
 * dropdown. Returns an array (not a fragment) because Listbox only reads direct option children.
 */
export function useStepOptions(steps: SequenceStep[]): React.ReactNode[] {
  const { templates } = useTemplates();
  return steps.map((s, i) => (
    <option key={i} value={String(i + 1)} title={templateName(s, templates)}>
      {`Step ${i + 1} · ${templateName(s, templates)} · ${s.delay_days === 0 ? 'no wait' : `after ${s.delay_days} day${s.delay_days === 1 ? '' : 's'}`}`}
    </option>
  ));
}
