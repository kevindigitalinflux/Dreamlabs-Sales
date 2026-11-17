import { useSearchParams } from 'react-router';
import { Tabs, TabPanel } from '../components/ui/Tabs';
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
  const { count } = useReplyAlerts();
  const tab = replyTab(params.get('tab'), count);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold">Emails</h1>
      <Tabs label="Email sections" value={tab} onChange={(key) => setParams({ tab: key })} tabs={TABS.map((t) => ({ id: t.key, label: t.label, count: t.key === 'replies' && count > 0 ? count : undefined }))} />
      <TabPanel id="templates" active={tab === 'templates'}><TemplateList /></TabPanel>
      <TabPanel id="sequences" active={tab === 'sequences'}><SequenceList /></TabPanel>
      <TabPanel id="release" active={tab === 'release'}><ReleaseQueue /></TabPanel>
      <TabPanel id="logs" active={tab === 'logs'}><EmailLogList /></TabPanel>
      <TabPanel id="replies" active={tab === 'replies'}><RepliesPanel /></TabPanel>
    </div>
  );
}
