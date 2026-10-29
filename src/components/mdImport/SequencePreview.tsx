import type { ImportFile } from '../../lib/mdImport/types';
import type { ImportSnapshot } from '../../lib/mdImport/store';
import { resolveSequence } from '../../lib/mdImport/extendedMatching';

/** Each step shows batch/organisation resolution before any sequence is saved. */
export function SequencePreview({ file, files, snapshot, onChange }: { file: ImportFile; files: ImportFile[]; snapshot: ImportSnapshot; onChange: (file: ImportFile) => void }) {
  if (file.parsed.type !== 'sequences') return null;
  return <div className="flex flex-col gap-3">{file.parsed.data.map((sequence, i) => {
    const resolved = resolveSequence(sequence, files, snapshot);
    const existing = snapshot.sequences?.find(row => row.name.toLowerCase() === sequence.name.toLowerCase());
    return <div key={i} className="min-w-0 rounded border border-line p-2">
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={!!file.selected[i]}
        onChange={event => onChange({ ...file, selected: file.selected.map((value, index) => index === i ? event.target.checked : value) })} />
        <span className="min-w-0 break-words font-semibold">{sequence.name}</span></label>
      <p className="text-xs text-muted">Inactive draft · {sequence.steps.length} steps · {sequence.icp ?? 'No ICP'} · {existing ? `Matches existing: ${existing.name}` : 'New'}</p>
      <ol className="list-inside list-decimal">{resolved.steps.map((step, index) => <li key={index} className="break-words">{step.template} · {step.wait_days} days · {step.id ? 'resolved' : step.source === 'batch' ? 'pending import' : 'unresolved'} ({step.source})</li>)}</ol>
      {resolved.errors.map((error, index) => <p key={index} role="alert" className="text-danger">{error}</p>)}
    </div>;
  })}</div>;
}
