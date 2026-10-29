import type { ImportFile } from '../../lib/mdImport/types';
import type { ImportSnapshot } from '../../lib/mdImport/store';
import { CompanyPreview } from './CompanyPreview';
import { ProfilePreview } from './ProfilePreview';
import { TemplatePreview } from './TemplatePreview';
import { Button } from '../ui/Button';
import { SelectField } from '../ui/Input';
import { SequencePreview } from './SequencePreview';
import { PackagePreview } from './PackagePreview';

const typeLabels = { 'company-context': 'Company context', 'icp-profiles': 'Customer profiles', 'email-templates': 'Email templates', sequences: 'Sequences', 'company-packages': 'Company packages' };
/** One file card; invalid files remain removable without discarding other previews. */
export function ImportPreviewCard({ file, files = [file], snapshot, pending, onChange, onRemove }: { file: ImportFile; files?: ImportFile[]; snapshot: ImportSnapshot; pending: string[]; onChange: (file: ImportFile) => void; onRemove: (id: string) => void }) {
  const p = file.parsed;
  const count = p.type === 'company-context' ? 1 : p.data?.length ?? 0;
  return <section className="min-w-0 rounded-xl border border-line p-3 text-sm">
    <h4 className="break-words font-bold">{file.filename}</h4>
    <p>{p.type ? typeLabels[p.type] : 'Unknown file type'} · {count} {count === 1 ? 'item' : 'items'}</p>
    <Button variant="ghost" onClick={() => onRemove(file.id)} aria-label={`Remove ${file.filename}`}>Remove file</Button>
    {p.errors.map((e, i) => <p key={i} role="alert" className="break-words text-danger">line {e.line}: {e.message}</p>)}
    {p.warnings.map((w, i) => <p key={i} className="break-words text-warning">line {w.line}: {w.message}</p>)}
    {!p.errors.length && <>
      {p.type !== 'company-context' && <SelectField label="Save choice" value={file.replace ? 'replace' : 'new'} onChange={(e) => onChange({ ...file, replace: e.target.value === 'replace' })}>
        <option value="new">Add new only, skip matches</option><option value="replace">Add new and replace matches</option>
      </SelectField>}
      <CompanyPreview file={file} context={snapshot.context} onChange={onChange} />
      <ProfilePreview file={file} profiles={snapshot.profiles} onChange={onChange} />
      <TemplatePreview file={file} profiles={snapshot.profiles} templates={snapshot.templates} pending={pending} onChange={onChange} />
      <SequencePreview file={file} files={files} snapshot={snapshot} onChange={onChange} />
      <PackagePreview file={file} current={snapshot.packages ?? null} onChange={onChange} />
    </>}
  </section>;
}
