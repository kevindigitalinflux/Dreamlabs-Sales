import type { ImportFile, NamedProfile, NamedTemplate } from '../../lib/mdImport/types';
import { matchTemplate, resolveProfile } from '../../lib/mdImport/matching';
import { CategoryBadge } from '../emails/CategoryControls';

/** Shows per-ICP matches and requires consent before importing unresolved rows without an ICP. */
export function TemplatePreview({ file, profiles, templates, pending, onChange }: { file: ImportFile; profiles: NamedProfile[]; templates: NamedTemplate[]; pending: string[]; onChange: (file: ImportFile) => void }) {
  if (file.parsed.type !== 'email-templates') return null;
  return <ul>{file.parsed.data.map((t, i) => {
    const resolved = resolveProfile(t.icp, profiles, pending);
    const unresolved = resolved === 'unresolved';
    const match = matchTemplate(t.name, unresolved ? null : resolved, templates);
    const checked = !!file.selected[i] && (!unresolved || !!file.withoutIcp?.[i]);
    return <li key={i} className="border-t border-line py-2">
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={checked}
        onChange={(e) => onChange({ ...file, selected: file.selected.map((v, j) => j === i ? e.target.checked : v), withoutIcp: file.selected.map((_, j) => j === i && unresolved ? e.target.checked : !!file.withoutIcp?.[j]) })} />
        <span className="min-w-0 break-words">{t.name} <CategoryBadge category={t.category} />
          <span className="block text-xs text-muted">ICP: {t.icp || 'None'} · {unresolved ? 'ICP not found' : match ? 'Matches existing template of the same name in the same ICP' : 'New'}</span>
          {unresolved && <span className="block text-xs text-warning">Import without an ICP</span>}
        </span>
      </label>
      <details><summary className="min-h-11 cursor-pointer py-2">View email text</summary><p className="font-semibold break-words">{t.subject}</p><p className="whitespace-pre-wrap break-words">{t.body}</p>{t.links.map((l, j) => <p key={j} className="break-all">{l.label}: {l.url}</p>)}</details>
    </li>;
  })}</ul>;
}
