import { STAGES } from '../../lib/utils';
import { emptyPickerFilters, type ContactStatus, type PickerFilters } from '../../lib/autopilotPicker';
import { Input, SelectField } from '../ui/Input';
import { MultiSelect } from '../ui/MultiSelect';
import { Button } from '../ui/Button';

export const CONTACT_OPTIONS = [
  { value: 'any', label: 'Any' }, { value: 'never', label: 'Never contacted' }, { value: 'contacted', label: 'Contacted before' },
  { value: 'due', label: 'Due today or overdue' }, { value: 'not_due', label: 'Not due yet' },
];
interface Props {
  value: PickerFilters;
  onChange: (next: PickerFilters) => void;
  pipelines: { id: string; name: string }[];
}
const CHECKBOX = 'h-4 w-4 shrink-0 accent-violet-500 focus-visible:outline-2 focus-visible:outline-violet-line';

/** Client-only filters, sharing Pipeline stage/readiness controls and labels. */
export function PickerFilterBar({ value, onChange, pipelines }: Props) {
  const selectedPipelines = value.pipelineIds ?? pipelines.map(p => p.id);
  return <div className="flex min-w-0 flex-col gap-3">
    <Input label="Search company, owner or email" type="search" value={value.search}
      onChange={e => onChange({ ...value, search: e.target.value })} placeholder="Search leads…" />
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <details className="min-w-0 rounded-lg border border-line p-3">
        <summary className="min-h-8 cursor-pointer break-words font-semibold focus-visible:outline-2 focus-visible:outline-violet-line">
          Pipelines ({selectedPipelines.length})
        </summary>
        <fieldset className="mt-2 flex max-h-60 min-w-0 flex-col overflow-y-auto">
          <legend className="sr-only">Filter pipelines</legend>
          <Button variant="secondary" onClick={() => onChange({ ...value, pipelineIds: null })}>All pipelines</Button>
          {pipelines.map(p => <label key={p.id} className="flex min-h-11 min-w-0 items-center gap-2 text-sm">
            <input type="checkbox" className={CHECKBOX} checked={selectedPipelines.includes(p.id)} onChange={e => onChange({ ...value,
              pipelineIds: e.target.checked ? [...selectedPipelines, p.id] : selectedPipelines.filter(id => id !== p.id) })} />
            <span className="min-w-0 break-words">{p.name}</span>
          </label>)}
        </fieldset>
      </details>
      <SelectField label="Contact status" value={value.contact} onChange={e => onChange({ ...value, contact: e.target.value as ContactStatus })}>
        {CONTACT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </SelectField>
    </div>
    <div className="flex flex-wrap gap-3">
      <MultiSelect label="Stage" options={STAGES} selected={value.stages} onChange={stages => onChange({ ...value, stages: stages as PickerFilters['stages'] })} />
      <MultiSelect label="Readiness" options={[{ value: 'ready', label: 'Ready' }, { value: 'almost', label: 'Almost' },
        { value: 'needs_work', label: 'Needs work' }, { value: 'not_checked', label: 'Not checked' }]} selected={value.readiness}
        onChange={readiness => onChange({ ...value, readiness: readiness as PickerFilters['readiness'] })} />
      <Button variant="secondary" onClick={() => onChange(emptyPickerFilters())}>Clear filters</Button>
    </div>
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" className={CHECKBOX} checked={value.verifiedEmail} onChange={e => onChange({ ...value, verifiedEmail: e.target.checked })} />
      Has a verified email
    </label>
    <p className="text-xs text-muted">Verified email uses the last saved Deep find check, including saved contacts. It does not run a new check.</p>
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" className={CHECKBOX} checked={value.hideIneligible} onChange={e => onChange({ ...value, hideIneligible: e.target.checked })} />
      Hide leads I can't pick
    </label>
  </div>;
}
