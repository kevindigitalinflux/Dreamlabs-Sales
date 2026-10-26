import type { ImportFile } from '../../lib/mdImport/types';

/** Shows current and incoming company context as plain text. */
export function CompanyPreview({ file, context, onChange }: { file: ImportFile; context: string; onChange: (file: ImportFile) => void }) {
  if (file.parsed.type !== 'company-context') return null;
  return <div className="flex flex-col gap-2">
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={!!file.selected[0]} onChange={(e) => onChange({ ...file, selected: [e.target.checked] })} />Import company context</label>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div><p className="font-semibold">Current</p><p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words">{context || 'empty'}</p></div>
      <div><p className="font-semibold">New</p><p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words">{file.parsed.data}</p></div>
    </div>
    <label className="flex flex-col gap-1">Save choice<select className="min-h-11 rounded border border-line bg-card px-2" value={file.append ? 'append' : 'replace'} onChange={(e) => onChange({ ...file, append: e.target.value === 'append' })}>
      <option value="replace">Replace</option><option value="append">Append below the existing text</option>
    </select></label>
  </div>;
}
