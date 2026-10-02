import type { IdealCustomerProfile } from '../../types';
import { SelectField } from '../ui/Input';

/** "Customer profile (optional)" picker used by the template editor, sequence builder and lead card. */
export function IcpSelect({ icps, value, onChange, hint, label = 'Customer profile (optional)' }: {
  icps: IdealCustomerProfile[];
  value: string | null;
  onChange: (icpId: string | null) => void;
  hint?: string;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <SelectField label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">None</option>
        {icps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        {/* A profile can be deleted while still referenced somewhere; keep the stale choice visible. */}
        {value && !icps.some((p) => p.id === value) && <option value={value}>(profile no longer available)</option>}
      </SelectField>
      {icps.length === 0 && <p className="text-xs text-muted">No profiles yet: an admin can add them under Settings, Ideal customer profiles.</p>}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
