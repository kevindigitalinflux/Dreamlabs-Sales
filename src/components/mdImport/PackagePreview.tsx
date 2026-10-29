import type { ImportFile } from '../../lib/mdImport/types';

/** Labels are saved, free-text details remain preview-only, and existing lead labels never change. */
export function PackagePreview({ file, current, onChange }: { file: ImportFile; current: string[] | null; onChange: (file: ImportFile) => void }) {
  if (file.parsed.type !== 'company-packages') return null;
  const selected = file.parsed.data.filter((_, i) => file.selected[i]).map(item => item.name.toLowerCase());
  const removed = file.replace ? (current ?? []).filter(label => !selected.includes(label.toLowerCase())) : [];
  return <div className="flex min-w-0 flex-col gap-2">
    <p className="text-muted">Details are shown for review only and are not stored. Only package labels are saved.</p>
    {current === null && <p className="text-muted">This organisation currently uses the built-in list. Importing creates a custom list from this file only.</p>}
    {removed.length > 0 && <p className="break-words text-warning">Leads may still use removed labels: {removed.join(', ')}. Their package text will stay unchanged.</p>}
    {file.parsed.data.map((item, i) => <div key={i} className="min-w-0 border-t border-line pt-2">
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={!!file.selected[i]}
        onChange={event => onChange({ ...file, selected: file.selected.map((value, index) => index === i ? event.target.checked : value) })} />
        <span className="min-w-0 break-words font-semibold">{item.name}</span></label>
      <p className="whitespace-pre-wrap break-words text-xs text-muted">{item.details}</p>
    </div>)}
  </div>;
}
