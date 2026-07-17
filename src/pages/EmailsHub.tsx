import { useSearchParams } from 'react-router';
import { ComingSoon } from '../components/layout/ComingSoon';
import { TemplateList } from '../components/emails/TemplateList';
import { SequenceList } from '../components/emails/SequenceList';

const TABS = [
  { key: 'templates', label: 'Templates' },
  { key: 'sequences', label: 'Sequences' },
  { key: 'logs', label: 'Logs' },
] as const;

/** /emails — templates / sequences / logs tabs (SPEC.md §13 routes collapsed to one hub). */
export function EmailsHub() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'templates';
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-extrabold">Emails</h1>
      <div className="flex overflow-hidden rounded-lg border border-line self-start" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            onClick={() => setParams({ tab: t.key })}
            className={`min-h-11 cursor-pointer px-5 text-sm font-semibold ${tab === t.key ? 'bg-violet/25 text-offwhite' : 'text-muted hover:text-offwhite'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'templates' && <TemplateList />}
      {tab === 'sequences' && <SequenceList />}
      {tab === 'logs' && <ComingSoon module="Email logs" />}
    </div>
  );
}
