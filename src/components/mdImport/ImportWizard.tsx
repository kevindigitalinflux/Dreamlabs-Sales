import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { loadImportSnapshot } from '../../lib/mdImport/store';
import type { ImportSnapshot } from '../../lib/mdImport/store';
import type { ImportFile } from '../../lib/mdImport/types';
import { effectiveSelection, pendingProfiles, readSetupFiles } from '../../lib/mdImport/preview';
import { applyImport } from '../../lib/mdImport/apply';
import type { ApplyResult } from '../../lib/mdImport/apply';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/Skeleton';
import { ImportWizardView } from './ImportWizardView';

/** Loads the org snapshot and applies only reviewed selections; all file reading stays local. */
export function ImportWizard({ orgId, userId, isAdmin, onClose, onApplied }: { orgId: string; userId: string; isAdmin: boolean; onClose: () => void; onApplied: () => void | Promise<void> }) {
  const [snapshot, setSnapshot] = useState<ImportSnapshot | null>(null);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [data, custom] = await Promise.all([loadImportSnapshot(supabase, orgId), supabase.from('custom_variables').select('key').eq('org_id', orgId)]);
        if (custom.error) throw new Error(custom.error.message);
        if (!cancelled) setSnapshot({ ...data, customKeys: (custom.data ?? []).map((v: { key: string }) => v.key) });
      } catch (error) {
        console.error('Could not load setup import preview', { orgId, error });
        if (!cancelled) setError('Could not load current setup. Close and try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);
  async function chooseFiles(incoming: File[]) {
    if (!snapshot || lock.current || result) return;
    lock.current = true; setReading(true);
    try {
      const pending = pendingProfiles(files).map((name) => ({ id: 'pending', name }));
      const added = await readSetupFiles(incoming, [...snapshot.profiles, ...pending], snapshot.customKeys, snapshot.context);
      setFiles((current) => [...current, ...added.map((f) => ({ ...f, id: crypto.randomUUID() }))]);
    } catch (error) { console.error('Could not prepare setup files', { orgId, error }); setError('Could not read the files. Close and try again.'); }
    finally { lock.current = false; setReading(false); }
  }
  async function apply() {
    if (!snapshot || lock.current || result || !isAdmin) return;
    lock.current = true; setBusy(true);
    try {
      const outcome = await applyImport(supabase, effectiveSelection(files, snapshot.profiles), { orgId, userId, isAdmin });
      setResult(outcome);
      if (outcome.saved.length) await onApplied();
    } catch (error) {
      console.error('Could not refresh setup after import', { orgId, error });
      setError('Changes were saved, but the lists could not refresh. Close and reload the page.');
    } finally { setBusy(false); lock.current = false; }
  }
  return <Modal open title="Import setup files" onClose={() => { if (!lock.current) onClose(); }}>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {!error && !snapshot && <Skeleton className="h-32 w-full" />}
    {snapshot && <ImportWizardView files={files} snapshot={snapshot} busy={busy} reading={reading} result={result}
      onFiles={(incoming) => void chooseFiles(incoming)} onChange={(file) => setFiles((old) => old.map((f) => f.id === file.id ? file : f))}
      onRemove={(id) => setFiles((old) => old.filter((f) => f.id !== id))} onApply={() => void apply()} />}
  </Modal>;
}
