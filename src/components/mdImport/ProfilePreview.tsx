import type { ImportFile, NamedProfile } from '../../lib/mdImport/types';
import { matchProfile } from '../../lib/mdImport/matching';

/** Row selection and profile matches use the database's name rule. */
export function ProfilePreview({ file, profiles, onChange }: { file: ImportFile; profiles: NamedProfile[]; onChange: (file: ImportFile) => void }) {
  if (file.parsed.type !== 'icp-profiles') return null;
  return <ul>{file.parsed.data.map((p, i) => {
    const match = matchProfile(p.name, profiles);
    return <li key={i} className="border-t border-line py-2">
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={!!file.selected[i]} onChange={(e) => onChange({ ...file, selected: file.selected.map((v, j) => j === i ? e.target.checked : v) })} />
        <span className="min-w-0 break-words">{p.name}<span className="block text-xs text-muted">{match ? `Matches existing: ${match.name}` : 'New'}</span></span>
      </label>
      <details><summary className="min-h-11 cursor-pointer py-2">View profile text</summary><dl className="space-y-2 whitespace-pre-wrap break-words">{Object.entries(p).filter(([key, value]) => key !== 'name' && value).map(([key, value]) => <div key={key}><dt className="font-semibold">{key.replaceAll('_', ' ')}</dt><dd>{value}</dd></div>)}</dl></details>
    </li>;
  })}</ul>;
}
