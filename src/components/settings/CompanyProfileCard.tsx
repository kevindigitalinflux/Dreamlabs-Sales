import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { PACKAGE_TIERS } from '../../lib/utils';
import { useOrg } from '../../hooks/useOrg';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Textarea } from '../ui/Input';

const MAX_PACKAGES = 30;
const MAX_NAME_LEN = 60;

/** One package per line -> trimmed, de-duplicated (case-insensitive), length-capped names. */
export function parsePackageLines(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const line of text.split('\n')) {
    const name = line.trim().slice(0, MAX_NAME_LEN);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names.slice(0, MAX_PACKAGES);
}

/**
 * "Company profile customization" — lets each org define the package names its
 * leads can be tagged with (previously every org saw DI Dreamlabs' packages).
 * Empty list = fall back to the built-in default list. Visible to every rep,
 * editable by org admins only — RLS (organizations_admin_update_context plus
 * the column-scoped grant on custom_packages) is the real gate.
 */
export function CompanyProfileCard() {
  const { currentOrg, setOrgPackages } = useOrg();
  const orgId = currentOrg?.id;
  const isOrgAdmin = currentOrg?.role === 'admin';
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setText((currentOrg?.custom_packages ?? []).join('\n'));
    setStatus('idle');
    // Re-seed only when switching org, not on every save's cache update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  if (!currentOrg || !orgId) return null;

  async function handleSave() {
    const names = parsePackageLines(text);
    setStatus('saving');
    const value = names.length > 0 ? names : null;
    const { error } = await supabase.from('organizations').update({ custom_packages: value }).eq('id', orgId!);
    if (error) { setStatus('error'); return; }
    setOrgPackages(orgId!, value);
    setText(names.join('\n'));
    setStatus('saved');
  }

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <h2 className="text-[18px] font-bold">Company profile customization</h2>
        <p className="text-sm text-muted">
          Packages: the offers {currentOrg.name} can tag a lead with on the Pipeline. Add one per line.
          Leave it empty to use the default list ({PACKAGE_TIERS.slice(0, 3).map((t) => t.label).join(', ')}…).
        </p>
        <Textarea
          label="Packages"
          value={text}
          onChange={(e) => { setText(e.target.value); setStatus('idle'); }}
          rows={6}
          disabled={!isOrgAdmin}
          placeholder={'e.g.\nWeekly Office Clean\n3-Month Deep-Clean\nOne-off Move-out Clean'}
        />
        {!isOrgAdmin && <p className="text-xs text-muted">Only an org admin can edit this.</p>}
        {isOrgAdmin && (
          <div className="flex items-center gap-3">
            <Button onClick={() => void handleSave()} disabled={status === 'saving'} loading={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
            {status === 'saved' && <span className="text-sm text-success">Saved ✓</span>}
            {status === 'error' && <span role="alert" className="text-sm text-danger">Could not save — try again.</span>}
          </div>
        )}
      </div>
    </Card>
  );
}
