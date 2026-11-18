import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Card } from '../components/ui/Card';
import { Input, SelectField } from '../components/ui/Input';
import { Collapsible } from '../components/ui/Collapsible';
import { Tabs, TabPanel } from '../components/ui/Tabs';
import { Popover } from '../components/ui/Popover';

/** Developer-only page (route exists only in dev builds) showing every shared building block in the current theme. */
export function UiPreview() {
  const [tab, setTab] = useState('overview');
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState('new');
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="font-heading text-[28px] font-bold">UI preview</h1>
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button><Button loading>Saving</Button><IconButton label="Add lead" icon={Plus} />
        </div>
        <Input label="Business name" defaultValue="Apex Plumbing" />
        <SelectField label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="new">New lead</option><option value="contacted">Contacted</option>
        </SelectField>
        <Card variant="flat">A flat block inside a raised card.</Card>
      </Card>
      <div className="flex flex-col gap-2">
        <Collapsible title="Contacts" summary="Phone, email" defaultOpen>Maya Brooks, owner</Collapsible>
        <Collapsible title="Notes" summary="None yet">No notes.</Collapsible>
        <Collapsible title="Emails" summary="2 sent">Two emails.</Collapsible>
      </div>
      <Card>
        <Tabs label="Lead sections" value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'contacts', label: 'Contacts', count: 3 }, { id: 'notes', label: 'Notes and emails' }]} />
        <TabPanel id="overview" active={tab === 'overview'}>Overview content</TabPanel>
        <TabPanel id="contacts" active={tab === 'contacts'}>Contacts content</TabPanel>
        <TabPanel id="notes" active={tab === 'notes'}>Notes content</TabPanel>
      </Card>
      <div>
        <button ref={anchor} type="button" onClick={() => setOpen((o) => !o)} className="min-h-11 cursor-pointer rounded-control border border-line px-4 font-semibold">Open popover</button>
        <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} label="Example" className="w-64">A popover panel.</Popover>
      </div>
    </div>
  );
}
