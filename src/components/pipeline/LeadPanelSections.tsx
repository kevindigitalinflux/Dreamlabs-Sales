import { useEffect, useState } from 'react';
import { ExternalLink, Mail, Phone, Star } from 'lucide-react';
import type { Lead, LeadNote, PackageTier } from '../../types';
import type { LeadPatch } from '../../lib/leadUpdates';
import { PACKAGE_TIERS, formatShortDate } from '../../lib/utils';
import { Input, SelectField } from '../ui/Input';
import { Skeleton } from '../ui/Skeleton';

/** Label/value row used for the read-only (derived) fields. */
export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Shared save-on-blur mechanics + status line (NextActionEditor pattern). */
function useSectionSave(onSave: (patch: LeadPatch) => Promise<string | null>) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  async function save(patch: LeadPatch) {
    setStatus('saving');
    const err = await onSave(patch);
    setStatus(err ? 'error' : 'saved');
  }
  return { status, setStatus, save };
}

function StatusLine({ status }: { status: SaveStatus }) {
  return (
    <p aria-live="polite" className="min-h-5 text-xs text-muted">
      {status === 'saving' && 'Saving…'}
      {status === 'saved' && 'Saved ✓'}
      {status === 'error' && <span className="text-red-400">Could not save — check your connection.</span>}
    </p>
  );
}

interface EditableSectionProps {
  lead: Lead;
  onSave: (patch: LeadPatch) => Promise<string | null>;
}

/** Contact block: phone/email/website/address, inline-editable, save on blur.
    Phone/email/website keep a tap-to-act icon link beside the input. */
export function ContactInfo({ lead, onSave }: EditableSectionProps) {
  const [form, setForm] = useState({
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    website: lead.website ?? '',
    address: lead.address ?? '',
    city: lead.city ?? '',
    postcode: lead.postcode ?? '',
  });
  const { status, setStatus, save } = useSectionSave(onSave);

  useEffect(() => {
    setForm({
      phone: lead.phone ?? '',
      email: lead.email ?? '',
      website: lead.website ?? '',
      address: lead.address ?? '',
      city: lead.city ?? '',
      postcode: lead.postcode ?? '',
    });
    setStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.phone, lead.email, lead.website, lead.address, lead.city, lead.postcode]);

  function blurSave(key: keyof typeof form) {
    const value = form[key].trim();
    if (value === (lead[key] ?? '')) return;
    void save({ [key]: value || null });
  }
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const action = 'flex h-11 w-11 shrink-0 items-center justify-center self-end rounded-lg text-cyan hover:bg-surface';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} onBlur={() => blurSave('phone')} />
        {lead.phone && <a href={`tel:${lead.phone}`} aria-label="Call" className={action}><Phone className="h-4 w-4" aria-hidden /></a>}
      </div>
      <div className="flex items-end gap-2">
        <Input label="Email" type="email" value={form.email} onChange={set('email')} onBlur={() => blurSave('email')} />
        {lead.email && <a href={`mailto:${lead.email}`} aria-label="Send email" className={action}><Mail className="h-4 w-4" aria-hidden /></a>}
      </div>
      <div className="flex items-end gap-2">
        <Input label="Website" type="url" value={form.website} onChange={set('website')} onBlur={() => blurSave('website')} placeholder="https://" />
        {lead.website && <a href={lead.website} target="_blank" rel="noreferrer" aria-label="Open website" className={action}><ExternalLink className="h-4 w-4" aria-hidden /></a>}
      </div>
      <Input label="Address" value={form.address} onChange={set('address')} onBlur={() => blurSave('address')} />
      <div className="flex gap-2">
        <Input label="City" value={form.city} onChange={set('city')} onBlur={() => blurSave('city')} />
        <Input label="Postcode" value={form.postcode} onChange={set('postcode')} onBlur={() => blurSave('postcode')} />
      </div>
      <StatusLine status={status} />
    </div>
  );
}

/** Pipeline block: package/value/vertical/rating editable; call stats read-only (derived). */
export function PipelineInfo({ lead, onSave }: EditableSectionProps) {
  const [dealValue, setDealValue] = useState(lead.deal_value?.toString() ?? '');
  const [vertical, setVertical] = useState(lead.vertical ?? '');
  const [rating, setRating] = useState(lead.google_rating?.toString() ?? '');
  const [reviews, setReviews] = useState(lead.review_count?.toString() ?? '');
  const { status, setStatus, save } = useSectionSave(onSave);

  useEffect(() => {
    setDealValue(lead.deal_value?.toString() ?? '');
    setVertical(lead.vertical ?? '');
    setRating(lead.google_rating?.toString() ?? '');
    setReviews(lead.review_count?.toString() ?? '');
    setStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.deal_value, lead.vertical, lead.google_rating, lead.review_count]);

  const toNum = (s: string) => (s.trim() === '' ? null : Number(s));

  function saveNumber(key: 'deal_value' | 'review_count', raw: string, current: number | null) {
    const n = toNum(raw);
    if (n === current || (n !== null && Number.isNaN(n))) return;
    void save({ [key]: n === null ? null : Math.max(0, n) });
  }
  function saveRating() {
    let n = toNum(rating);
    if (n !== null) {
      if (Number.isNaN(n)) return;
      n = Math.max(0, Math.min(5, n));
      setRating(n.toString());
    }
    if (n === lead.google_rating) return;
    void save({ google_rating: n });
  }

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Package"
        value={lead.package_tier ?? ''}
        onChange={(e) => void save({ package_tier: (e.target.value || null) as PackageTier | null })}
      >
        <option value="">Not set</option>
        {PACKAGE_TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </SelectField>
      <Input label="Deal value (£)" type="number" min="0" value={dealValue} onChange={(e) => setDealValue(e.target.value)} onBlur={() => saveNumber('deal_value', dealValue, lead.deal_value)} />
      <Input label="Vertical" value={vertical} onChange={(e) => setVertical(e.target.value)} onBlur={() => { if (vertical.trim() !== (lead.vertical ?? '')) void save({ vertical: vertical.trim() || null }); }} placeholder="e.g. Commercial cleaning" />
      <div className="flex gap-2">
        <Input label="Google rating" type="number" min="0" max="5" step="0.1" value={rating} onChange={(e) => setRating(e.target.value)} onBlur={saveRating} />
        <Input label="Reviews" type="number" min="0" value={reviews} onChange={(e) => setReviews(e.target.value)} onBlur={() => saveNumber('review_count', reviews, lead.review_count)} />
      </div>
      {lead.google_rating !== null && (
        <p className="flex items-center gap-1 text-xs text-muted">
          <Star className="h-3.5 w-3.5 text-amber-400" aria-hidden />
          {lead.google_rating} ({lead.review_count ?? 0} reviews)
        </p>
      )}
      <div>
        <InfoRow label="Calls made">{lead.call_count}</InfoRow>
        <InfoRow label="Last contacted">{lead.last_contacted_at ? formatShortDate(lead.last_contacted_at) : 'Never'}</InfoRow>
      </div>
      <StatusLine status={status} />
    </div>
  );
}

/** Latest-notes preview (last 2) with loading/empty states. */
export function NotesPreview({ notes, loading }: { notes: LeadNote[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-16 w-full" />;
  if (notes.length === 0) return <p className="text-sm text-muted">No notes yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {notes.slice(0, 2).map((n) => (
        <li key={n.id} className="rounded-lg bg-surface/60 p-2 text-sm">
          <p className="line-clamp-3 whitespace-pre-wrap">{n.content}</p>
          <p className="mt-1 text-xs text-muted">{formatShortDate(n.created_at)}</p>
        </li>
      ))}
    </ul>
  );
}
