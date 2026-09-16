import { Building2, ChevronDown } from 'lucide-react';
import { useOrg } from '../../hooks/useOrg';

/** Org switcher — renders nothing for single-org users. */
export function OrgSwitcher() {
  const { currentOrg, orgs, switchOrg } = useOrg();
  if (orgs.length <= 1) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <Building2 className="h-4 w-4 text-muted" aria-hidden />
      <div className="relative">
        <select
          aria-label="Current organization"
          value={currentOrg?.id ?? ''}
          onChange={(e) => switchOrg(e.target.value)}
          className="min-h-11 cursor-pointer appearance-none rounded-lg border border-line bg-surface py-2 pl-2 pr-8 text-sm font-semibold outline-none focus:border-violet"
        >
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      </div>
    </label>
  );
}
