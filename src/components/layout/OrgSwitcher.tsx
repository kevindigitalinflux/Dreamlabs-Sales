import { Building2 } from 'lucide-react';
import { useOrg } from '../../hooks/useOrg';
import { Listbox } from '../ui/Listbox';

/** Org switcher — renders nothing for single-org users. */
export function OrgSwitcher() {
  const { currentOrg, orgs, switchOrg } = useOrg();
  if (orgs.length <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Building2 className="h-4 w-4 text-muted" aria-hidden />
      <Listbox
        ariaLabel="Current organization"
        value={currentOrg?.id ?? ''}
        onChange={(e) => switchOrg(e.target.value)}
        fullWidth={false}
        className="text-sm font-semibold"
      >
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Listbox>
    </div>
  );
}
