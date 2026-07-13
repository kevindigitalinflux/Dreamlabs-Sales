import { ExternalLink, Mail, Phone, Star } from 'lucide-react';
import type { Lead, LeadNote } from '../../types';
import { formatCurrency, formatShortDate, packageLabel } from '../../lib/utils';
import { Skeleton } from '../ui/Skeleton';

/** Label/value row used throughout the panel. */
export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

/** Contact block: phone (tel:), email (mailto:), website. */
export function ContactInfo({ lead }: { lead: Lead }) {
  return (
    <div className="flex flex-col gap-1">
      {lead.phone && (
        <a href={`tel:${lead.phone}`} className="flex min-h-11 items-center gap-2 text-sm hover:text-cyan">
          <Phone className="h-4 w-4 text-muted" aria-hidden />{lead.phone}
        </a>
      )}
      {lead.email && (
        <a href={`mailto:${lead.email}`} className="flex min-h-11 items-center gap-2 text-sm hover:text-cyan">
          <Mail className="h-4 w-4 text-muted" aria-hidden />{lead.email}
        </a>
      )}
      {lead.website && (
        <a href={lead.website} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 text-sm hover:text-cyan">
          <ExternalLink className="h-4 w-4 text-muted" aria-hidden />
          <span className="truncate">{lead.website}</span>
        </a>
      )}
      {!lead.phone && !lead.email && !lead.website && <p className="text-sm text-muted">No contact details yet.</p>}
    </div>
  );
}

/** Pipeline block: package, value, vertical, rating, call stats. */
export function PipelineInfo({ lead }: { lead: Lead }) {
  return (
    <div>
      <InfoRow label="Package">{packageLabel(lead.package_tier)}</InfoRow>
      <InfoRow label="Deal value">{lead.deal_value !== null ? formatCurrency(lead.deal_value) : '—'}</InfoRow>
      <InfoRow label="Vertical">{lead.vertical ?? '—'}</InfoRow>
      <InfoRow label="Google rating">
        {lead.google_rating !== null ? (
          <span className="inline-flex items-center gap-1">
            <Star className="h-3.5 w-3.5 text-amber-400" aria-hidden />
            {lead.google_rating} ({lead.review_count ?? 0} reviews)
          </span>
        ) : '—'}
      </InfoRow>
      <InfoRow label="Calls made">{lead.call_count}</InfoRow>
      <InfoRow label="Last contacted">{lead.last_contacted_at ? formatShortDate(lead.last_contacted_at) : 'Never'}</InfoRow>
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
