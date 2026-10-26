import type { ApplyResult } from '../../lib/mdImport/apply';

/** Reports every saved, skipped and unsaved item after success or partial failure. */
export function ImportSummary({ result }: { result: ApplyResult }) {
  return <div className="space-y-3 break-words" role="status">
    <p className="font-bold">{result.error ? 'Import stopped' : 'Import complete'}</p>
    {result.error && <p role="alert" className="text-danger">{result.error}</p>}
    {[['Saved', result.saved], ['Skipped', result.skipped], ['Not saved', result.notSaved]].map(([title, rows]) => <div key={title as string}>
      <p className="font-semibold">{title}: {(rows as string[]).length}</p><ul>{(rows as string[]).map((row, i) => <li key={i}>{row}</li>)}</ul>
    </div>)}
    {result.error && <p>Close and reopen the import to review current data before trying again. Matches are skipped by default.</p>}
  </div>;
}
