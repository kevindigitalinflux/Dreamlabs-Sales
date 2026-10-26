import type { EmailTemplate } from '../../types';
import type { NamedProfile } from '../../lib/mdImport/types';
import { useRef, useState } from 'react';
import { copyTemplateRows } from '../../lib/mdImport/matching';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
export interface CopyDialogProps { templates: EmailTemplate[]; icps: NamedProfile[]; orgId: string; userId: string; onCopy: (sources: EmailTemplate[], target: NamedProfile) => Promise<string | null>; onClose: () => void }
/** Selects source and target ICPs and previews exact copy names before confirmation. */
export function CopyTemplatesDialog({ templates, icps, orgId, userId, onCopy, onClose }: CopyDialogProps) {
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const sourceTemplates = templates.filter((t) => t.icp_id === sourceId);
  const selected = sourceTemplates.filter((t) => !excluded.includes(t.id));
  const target = icps.find((p) => p.id === targetId);
  const copies = target ? copyTemplateRows(selected, templates, orgId, userId, target) : [];
  async function copy() {
    if (!target || !selected.length || targetId === sourceId || lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const problem = await onCopy(selected, target);
      if (problem) setError(problem); else onClose();
    } catch (error) { console.error('Could not copy template set', { orgId, error }); setError('Could not copy templates. Close and check the list before trying again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Modal open title="Copy templates to another ICP" onClose={() => { if (!lock.current) onClose(); }}>
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-3">
        <legend className="sr-only">Choose profiles and templates</legend>
        <label className="flex flex-col gap-1">Source ICP<select className="min-h-11 rounded border border-line bg-card px-2" value={sourceId} onChange={(e) => { setSourceId(e.target.value); setExcluded([]); setError(null); }}>
          <option value="">Choose a profile</option>{icps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        <label className="flex flex-col gap-1">Target ICP<select className="min-h-11 rounded border border-line bg-card px-2" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">Choose a profile</option>{icps.filter((p) => p.id !== sourceId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        {sourceId && !sourceTemplates.length && <p>No templates for this profile.</p>}
        {sourceTemplates.map((t) => <label key={t.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={!excluded.includes(t.id)} onChange={(e) => setExcluded((old) => e.target.checked ? old.filter((id) => id !== t.id) : [...old, t.id])} /><span className="min-w-0 break-words">{t.name}</span></label>)}
      </fieldset>
      {copies.length > 0 && <div role="status"><p className="font-bold">New names</p><ul className="break-words">{copies.map((t, i) => <li key={i}>{t.name}</li>)}</ul></div>}
      <p className="text-muted">Copies keep links and attached files. Review the copies before sending.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <Button disabled={busy || !sourceId || !target || sourceId === targetId || !selected.length} onClick={() => void copy()}>{busy ? 'Copying…' : 'Copy templates'}</Button>
    </div>
  </Modal>;
}
