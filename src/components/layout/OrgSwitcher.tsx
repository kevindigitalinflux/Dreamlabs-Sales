import { Building2 } from 'lucide-react';
import { useOrg } from '../../hooks/useOrg';

/** Org switcher — renders nothing for single-org users. */
export function OrgSwitcher() {
  const { currentOrg, orgs, switchOrg } = useOrg();
  if (orgs.length <= 1) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <Building2 className="h-4 w-4 text-muted" aria-hidden />
      <select
        aria-label="Current organization"
        value={currentOrg?.id ?? ''}
        onChange={(e) => switchOrg(e.target.value)}
        className="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-2 text-sm font-semibold"
      >
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}
