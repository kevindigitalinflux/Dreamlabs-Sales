import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useOrg } from '../../hooks/useOrg';
import { Button } from '../ui/Button';
import { ImportWizard } from './ImportWizard';

/** Both admin entry points open the same org-bound wizard. */
export function ImportSetupButton({ label = 'Import setup files', onApplied }: { label?: string; onApplied: () => void | Promise<void> }) {
  const { currentOrg } = useOrg();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  if (currentOrg?.role !== 'admin' || !session) return null;
  return <>
    <Button variant="secondary" onClick={() => setOpen(true)}>{label}</Button>
    {open && <ImportWizard key={currentOrg.id} orgId={currentOrg.id} userId={session.user.id} isAdmin onClose={() => setOpen(false)} onApplied={onApplied} />}
  </>;
}
