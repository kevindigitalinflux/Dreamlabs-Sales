import type { ImportFile } from '../../lib/mdImport/types';
import type { ImportSnapshot } from '../../lib/mdImport/store';
import type { ApplyResult } from '../../lib/mdImport/apply';
import { pendingProfiles } from '../../lib/mdImport/preview';
import { resolveProfile } from '../../lib/mdImport/matching';
import { resolveSequence } from '../../lib/mdImport/extendedMatching';
import { FileDropArea } from './FileDropArea';
import { ImportPreviewCard } from './ImportPreviewCard';
import { ImportSummary } from './ImportSummary';
import { Button } from '../ui/Button';
export interface WizardViewProps {
  files: ImportFile[]; snapshot: ImportSnapshot; busy: boolean; reading: boolean; result: ApplyResult | null;
  onFiles: (files: File[]) => void; onChange: (file: ImportFile) => void; onRemove: (id: string) => void; onApply: () => void;
}
/** File review and apply states shared by both entry points. */
export function ImportWizardView({ files, snapshot, busy, reading, result, onFiles, onChange, onRemove, onApply }: WizardViewProps) {
  if (result) return <ImportSummary result={result} />;
  const pending = pendingProfiles(files);
  const hasSelection = files.some((f) => f.selected.some((selected, i) => selected && (f.parsed.type !== 'email-templates' || resolveProfile(f.parsed.data[i].icp, snapshot.profiles, pending) !== 'unresolved' || f.withoutIcp?.[i])));
  const multipleContexts = files.filter((f) => f.parsed.type === 'company-context' && f.selected[0]).length > 1;
  const invalidSequences = files.some(file => file.parsed.type === 'sequences' && file.parsed.data.some((sequence, i) => file.selected[i] && resolveSequence(sequence, files, snapshot).errors.length > 0));
  const packageFiles = files.filter(file => file.parsed.type === 'company-packages' && file.selected.some(Boolean));
  const multiplePackages = packageFiles.length > 1 && packageFiles.some(file => file.replace);
  return <div className="flex min-w-0 flex-col gap-4">
    <p className="text-sm text-muted">Review the text before saving. Company context and customer profiles feed AI email drafting.</p>
    <fieldset disabled={busy || reading} className="flex min-w-0 flex-col gap-3">
      <legend className="sr-only">Setup files</legend>
      <FileDropArea onFiles={onFiles} disabled={busy || reading} />
      {files.map((file) => <ImportPreviewCard key={file.id} file={file} files={files} snapshot={snapshot} pending={pending} onChange={onChange} onRemove={onRemove} />)}
    </fieldset>
    {multipleContexts && <p role="alert" className="text-danger">Choose only one company context file.</p>}
    {multiplePackages && <p role="alert" className="text-danger">Choose only one package file when replacing the list.</p>}
    <p role="status" className="text-sm">{reading ? 'Reading files…' : busy ? 'Importing…' : `${files.length} files ready for review`}</p>
    <Button disabled={busy || reading || !hasSelection || multipleContexts || multiplePackages || invalidSequences || files.some((f) => f.parsed.errors.length > 0)} onClick={onApply}>{busy ? 'Importing…' : 'Import'}</Button>
  </div>;
}
