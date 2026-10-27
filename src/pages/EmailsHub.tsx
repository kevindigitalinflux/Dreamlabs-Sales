import { useSearchParams } from 'react-router';
import { useId } from 'react';
import { TemplateList } from '../components/emails/TemplateList';
import { SequenceList } from '../components/emails/SequenceList';
import { ReleaseQueue } from '../components/emails/ReleaseQueue';
import { EmailLogList } from '../components/emails/EmailLogList';
import { RepliesPanel } from '../components/emails/RepliesPanel';
import { useReplyAlerts } from '../hooks/useReplyAlerts';
import { replyTab } from '../lib/replyAlertsView';

const TABS = [
  { key: 'replies', label: 'Replies' },
  { key: 'templates', label: 'Templates' },
  { key: 'sequences', label: 'Sequences' },
  { key: 'release', label: 'Waiting to release' },
  { key: 'logs', label: 'Logs' },
] as const;

/** /emails — templates / sequences / release / logs tabs (SPEC.md §13 routes collapsed to one hub). */
export function EmailsHub() {
  const [params, setParams] = useSearchParams();
  const instance = useId();
  const { count } = useReplyAlerts();
  const tab = replyTab(params.get('tab'), count);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-extrabold">Emails</h1>
      <div className="flex max-w-full flex-wrap rounded-lg border border-line self-start" role="tablist" aria-label="Email sections">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} tabIndex={tab === t.key ? 0 : -1}
            id={`${instance}-${t.key}`} aria-controls={`${instance}-panel`}
            onKeyDown={event => {
              const index = TABS.findIndex(item => item.key === t.key);
              const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
              if (next === null) return;
              event.preventDefault(); setParams({ tab: TABS[next]!.key });
              (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
            }}
            onClick={() => setParams({ tab: t.key })}
            className={`min-h-11 cursor-pointer px-5 text-sm font-semibold ${tab === t.key ? 'bg-violet/25 text-offwhite' : 'text-muted hover:text-offwhite'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${instance}-panel`} aria-labelledby={`${instance}-${tab}`}>
      {tab === 'templates' && <TemplateList />}
      {tab === 'sequences' && <SequenceList />}
      {tab === 'release' && <ReleaseQueue />}
      {tab === 'logs' && <EmailLogList />}
      {tab === 'replies' && <RepliesPanel />}
      </div>
    </div>
  );
}
