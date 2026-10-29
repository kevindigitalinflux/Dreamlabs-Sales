import { memo, useId } from 'react';
import type { PickerLead } from '../../lib/selectableLeads';
import { pickerReason } from '../../lib/autopilotPicker';
import { STAGES } from '../../lib/utils';

/** Memoised row; disabled leads keep their reason visible and linked to the checkbox. */
export const PickerLeadRow = memo(function PickerLeadRow({ lead, checked, onToggle, now }: {
  lead: PickerLead; checked: boolean; onToggle: (id: string, checked: boolean) => void; now: Date;
}) {
  const reasonId = useId();
  return <label className={`flex min-h-11 min-w-0 items-start gap-3 py-2 ${lead.eligible ? 'cursor-pointer' : 'text-muted'}`}>
    <input type="checkbox" aria-describedby={reasonId} disabled={!lead.eligible} checked={checked}
      onChange={e => onToggle(lead.id, e.target.checked)}
      className="mt-1 h-4 w-4 shrink-0 accent-violet-500 focus-visible:outline-2 focus-visible:outline-violet-line" />
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className={`break-words font-semibold ${lead.eligible ? '' : 'opacity-70'}`}>{lead.business_name}</span>
      <span className="break-words text-xs text-muted">{STAGES.find(stage => stage.value === lead.stage)?.label ?? lead.stage}
        {!lead.email && ' · No email yet'}</span>
      <span id={reasonId} className="break-words text-xs text-muted">{pickerReason(lead, now)}</span>
    </span>
  </label>;
});
