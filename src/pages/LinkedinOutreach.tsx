import { useEffect, useState } from 'react';
import { Contact as LinkedinIcon, CheckCircle2, ExternalLink, Sparkles, SkipForward } from 'lucide-react';
import { useLinkedinOutreach } from '../hooks/useLinkedinOutreach';
import { usePipeline } from '../hooks/usePipeline';
import { useOrg } from '../hooks/useOrg';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, SelectField, Textarea } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { DeleteContactButton, LeadSource } from '../components/linkedin/LinkedinContactParts';

/** LinkedIn contacts + drafts review queue (SPEC.md §2 Channel 2). */
export function LinkedinOutreach() {
  const { contacts, drafts, loading, addContact, draftFor, approve, skip, markSent, deleteContact } = useLinkedinOutreach();
  const { pipelines } = usePipeline();
  const { currentOrg } = useOrg();
  const [form, setForm] = useState({ full_name: '', linkedin_url: '', context_signal: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pipelineFilter, setPipelineFilter] = useState(''); // '' = all, 'unlinked' = no lead_id, else a pipeline id
  const [leadFilter, setLeadFilter] = useState(''); // '' = every lead in the chosen pipeline, else a lead id
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDrafting, setBulkDrafting] = useState(false);

  async function handleAdd() {
    if (!form.full_name.trim()) return;
    setBusy('add'); setError(null);
    const err = await addContact(form);
    setBusy(null);
    if (err) setError(err);
    else setForm({ full_name: '', linkedin_url: '', context_signal: '' });
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleBulkDraft() {
    setBulkDrafting(true);
    setError(null);
    // Filter against the currently-visible pending list, not the raw
    // `selected` Set — a contact drafted individually via its own "Draft
    // message" button, or hidden by a search/pipeline filter change, must
    // never be re-drafted just because it's still technically checked (see
    // I3 in the 2026-09-28 final review).
    const targets = filteredPendingContacts.filter((c) => selected.has(c.id));
    let drafted = 0;
    let firstFailReason: string | null = null;
    for (const contact of targets) {
      const err = await draftFor(contact.id);
      if (err) { if (!firstFailReason) firstFailReason = err; continue; }
      drafted++;
    }
    setBulkDrafting(false);
    setSelected(new Set());
    if (drafted < targets.length) setError(`Drafted ${drafted} of ${targets.length}${firstFailReason ? ` — ${firstFailReason}` : ''}`);
  }

  const pendingContacts = contacts.filter((c) => c.status === 'pending');
  const orgPipelines = pipelines.filter((p) => p.org_id === currentOrg?.id);

  // Checks the contact's own lead_id column directly rather than whether the
  // joined `lead` object happened to resolve — a contact can have a non-null
  // lead_id whose `lead` join comes back null under RLS (a lead the caller
  // isn't permitted to view; see I2 in the 2026-09-28 final review), and
  // that is NOT the same thing as being genuinely unlinked. linkedin_contacts
  // .lead_id is ON DELETE CASCADE from leads, so a hard-deleted lead removes
  // the contact row entirely rather than leaving a dangling lead_id — the
  // RLS-invisible case is the only real source of a null join with a
  // non-null lead_id today.
  function matchesSearchAndPipeline(fullName: string, leadId: string | null, lead: { id: string; business_name: string; pipeline_id: string } | null): boolean {
    const q = search.trim().toLowerCase();
    if (q && !fullName.toLowerCase().includes(q) && !(lead?.business_name.toLowerCase().includes(q))) return false;
    if (pipelineFilter === 'unlinked') return leadId === null;
    if (pipelineFilter && lead?.pipeline_id !== pipelineFilter) return false;
    if (leadFilter && lead?.id !== leadFilter) return false;
    return true;
  }

  // Leads in the chosen pipeline that have at least one LinkedIn contact, for the second dropdown.
  const pipelineLeads = pipelineFilter && pipelineFilter !== 'unlinked'
    ? [...new Map(contacts.filter((c) => c.lead?.pipeline_id === pipelineFilter).map((c) => [c.lead!.id, c.lead!.business_name])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
    : [];

  const filteredPendingContacts = pendingContacts.filter((c) => matchesSearchAndPipeline(c.full_name, c.lead_id, c.lead));
  const filteredDrafts = drafts.filter((d) => matchesSearchAndPipeline(d.contact.full_name, d.contact.lead_id, d.contact.lead));

  // Prunes stale selections whenever the visible pending list changes (an
  // individual "Draft message" click, a search/pipeline filter change, or a
  // refresh) so the bulk button can never count or act on a contact that's
  // no longer shown — mirrors ReleaseQueue.tsx's identical pattern for its
  // own selection Set (see I3 in the 2026-09-28 final review).
  useEffect(() => {
    setSelected((prev) => {
      const visibleIds = new Set(filteredPendingContacts.map((c) => c.id));
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredPendingContacts]);

  if (loading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-3">
        <LinkedinIcon className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">LinkedIn outreach</h1>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Contact or company name" className="max-w-xs" />
        <SelectField label="Pipeline" value={pipelineFilter} onChange={(e) => { setPipelineFilter(e.target.value); setLeadFilter(''); }} className="max-w-xs">
          <option value="">All</option>
          <option value="unlinked">Unlinked</option>
          {orgPipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
        {pipelineLeads.length > 0 && (
          <SelectField label="Lead" value={leadFilter} onChange={(e) => setLeadFilter(e.target.value)} className="max-w-xs">
            <option value="">All leads</option>
            {pipelineLeads.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </SelectField>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <Card>
        <div className="flex flex-col gap-3">
          <p className="font-semibold">Add a contact</p>
          <Input label="Full name" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
          <Input label="LinkedIn URL (optional)" value={form.linkedin_url} onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))} />
          <Textarea label="Context signal (optional — a recent post, job change, etc.)" value={form.context_signal} onChange={(e) => setForm((f) => ({ ...f, context_signal: e.target.value }))} />
          <Button onClick={() => void handleAdd()} disabled={busy === 'add' || !form.full_name.trim()} loading={busy === 'add'}>{busy === 'add' ? 'Adding…' : 'Add contact'}</Button>
        </div>
      </Card>

      {filteredPendingContacts.length > 0 && (
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Not yet drafted</p>
              {selected.size > 0 && (
                <Button variant="secondary" onClick={() => void handleBulkDraft()} disabled={bulkDrafting} loading={bulkDrafting}>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  {bulkDrafting ? 'Drafting…' : `Draft messages (${selected.size})`}
                </Button>
              )}
            </div>
            {filteredPendingContacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-surface/50 p-3">
                <label className="flex min-h-11 cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelected(c.id)} className="h-4 w-4 accent-violet-500" />
                  <span className="min-w-0">
                    <span className="block font-semibold">{c.full_name}</span>
                    <LeadSource contact={c} />
                  </span>
                </label>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="secondary" onClick={() => void (async () => { setBusy(c.id); setError(await draftFor(c.id)); setBusy(null); })()} disabled={busy === c.id} loading={busy === c.id}>
                    <Sparkles className="h-4 w-4" aria-hidden /> {busy === c.id ? 'Drafting…' : 'Draft message'}
                  </Button>
                  <DeleteContactButton onDelete={() => deleteContact(c)} onError={setError} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <p className="font-semibold">Review queue</p>
        {filteredDrafts.length === 0 && (
          <EmptyState icon={LinkedinIcon} title="No drafts waiting" hint="Add a contact and draft a message to see it here." />
        )}
        {filteredDrafts.map((d) => (
          <Card key={d.id}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">{d.contact.full_name}</p>
                  <LeadSource contact={d.contact} />
                </div>
                {d.contact.linkedin_url && (
                  <a href={d.contact.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-cyan">
                    Open profile <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{d.message}</p>
              <div className="flex flex-wrap items-center gap-2">
                {d.status === 'draft' && (
                  <>
                    <Button onClick={() => void (async () => { setBusy(d.id); setError(await approve(d.id)); setBusy(null); })()} disabled={busy === d.id} loading={busy === d.id}><CheckCircle2 className="h-4 w-4" aria-hidden /> Approve</Button>
                    <Button variant="ghost" onClick={() => void (async () => { setBusy(d.id); setError(await skip(d.id)); setBusy(null); })()} disabled={busy === d.id} loading={busy === d.id}><SkipForward className="h-4 w-4" aria-hidden /> Skip</Button>
                  </>
                )}
                {d.status === 'approved' && (
                  <Button onClick={() => void (async () => { setBusy(d.id); setError(await markSent(d)); setBusy(null); })()} disabled={busy === d.id} loading={busy === d.id}>Mark as sent</Button>
                )}
                <DeleteContactButton onDelete={() => deleteContact(d.contact)} onError={setError} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
