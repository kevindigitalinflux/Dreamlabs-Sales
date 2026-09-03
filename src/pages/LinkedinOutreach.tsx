import { useState } from 'react';
import { Contact as LinkedinIcon, CheckCircle2, ExternalLink, Sparkles, SkipForward } from 'lucide-react';
import { useLinkedinOutreach } from '../hooks/useLinkedinOutreach';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Textarea } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

/** LinkedIn contacts + drafts review queue (SPEC.md §2 Channel 2). */
export function LinkedinOutreach() {
  const { contacts, drafts, loading, addContact, draftFor, approve, skip, markSent } = useLinkedinOutreach();
  const [form, setForm] = useState({ full_name: '', linkedin_url: '', context_signal: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!form.full_name.trim()) return;
    setBusy('add'); setError(null);
    const err = await addContact(form);
    setBusy(null);
    if (err) setError(err);
    else setForm({ full_name: '', linkedin_url: '', context_signal: '' });
  }

  const pendingContacts = contacts.filter((c) => c.status === 'pending');

  if (loading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-3">
        <LinkedinIcon className="h-6 w-6 text-cyan" aria-hidden />
        <h1 className="text-[28px] font-extrabold">LinkedIn outreach</h1>
      </header>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      <Card>
        <div className="flex flex-col gap-3">
          <p className="font-semibold">Add a contact</p>
          <Input label="Full name" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
          <Input label="LinkedIn URL (optional)" value={form.linkedin_url} onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))} />
          <Textarea label="Context signal (optional — a recent post, job change, etc.)" value={form.context_signal} onChange={(e) => setForm((f) => ({ ...f, context_signal: e.target.value }))} />
          <Button onClick={() => void handleAdd()} disabled={busy === 'add' || !form.full_name.trim()}>{busy === 'add' ? 'Adding…' : 'Add contact'}</Button>
        </div>
      </Card>

      {pendingContacts.length > 0 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Not yet drafted</p>
            {pendingContacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-surface/50 p-3">
                <span className="font-semibold">{c.full_name}</span>
                <Button variant="secondary" onClick={() => void (async () => { setBusy(c.id); setError(await draftFor(c.id)); setBusy(null); })()} disabled={busy === c.id}>
                  <Sparkles className="h-4 w-4" aria-hidden /> {busy === c.id ? 'Drafting…' : 'Draft message'}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <p className="font-semibold">Review queue</p>
        {drafts.length === 0 && (
          <EmptyState icon={LinkedinIcon} title="No drafts waiting" hint="Add a contact and draft a message to see it here." />
        )}
        {drafts.map((d) => (
          <Card key={d.id}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{d.contact.full_name}</p>
                {d.contact.linkedin_url && (
                  <a href={d.contact.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-cyan">
                    Open profile <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{d.message}</p>
              <div className="flex gap-2">
                {d.status === 'draft' && (
                  <>
                    <Button onClick={() => void approve(d.id)}><CheckCircle2 className="h-4 w-4" aria-hidden /> Approve</Button>
                    <Button variant="ghost" onClick={() => void skip(d.id)}><SkipForward className="h-4 w-4" aria-hidden /> Skip</Button>
                  </>
                )}
                {d.status === 'approved' && (
                  <Button onClick={() => void markSent(d.id, d.contact.id)}>Mark as sent</Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
