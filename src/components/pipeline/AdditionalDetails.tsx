import { X } from 'lucide-react';
import type { LeadPatch } from '../../lib/leadUpdates';
import type { Lead } from '../../types';

type Column = 'additional_emails' | 'additional_phones' | 'additional_websites' | 'additional_owners';

const GROUPS: { column: Column; label: string; href?: (value: string) => string }[] = [
  { column: 'additional_emails', label: 'Additional emails', href: (v) => `mailto:${v}` },
  { column: 'additional_phones', label: 'Additional phones', href: (v) => `tel:${v}` },
  // Only ever http(s): a stored value could be anything a scraper or a person typed.
  { column: 'additional_websites', label: 'Additional websites', href: (v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`) },
  { column: 'additional_owners', label: 'Additional owners' },
];

/**
 * Extra emails/phones/websites/owners kept alongside a lead's primary ones (from
 * Fill missing details, when the user chose to add rather than replace). Renders
 * nothing when there are none, so leads without any look unchanged. Each value can
 * be removed; the primary fields above stay the ones used everywhere else.
 */
export function AdditionalDetails({ lead, onSave }: { lead: Lead; onSave: (patch: LeadPatch) => Promise<string | null> }) {
  const groups = GROUPS.map((g) => ({ ...g, values: lead[g.column] ?? [] })).filter((g) => g.values.length > 0);
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface/60 p-3">
      {groups.map((g) => (
        <div key={g.column}>
          <p className="mb-1 text-xs font-semibold text-muted">{g.label}</p>
          <ul className="flex flex-wrap gap-1.5">
            {g.values.map((value) => (
              <li key={value} className="flex items-center gap-1 rounded-full border border-line bg-card py-0.5 pl-2.5 pr-1 text-sm">
                {g.href
                  ? <a href={g.href(value)} target={g.column === 'additional_websites' ? '_blank' : undefined} rel="noreferrer" className="text-cyan hover:underline">{value}</a>
                  : <span>{value}</span>}
                <button
                  type="button"
                  aria-label={`Remove ${value}`}
                  onClick={() => void onSave({ [g.column]: g.values.filter((v) => v !== value) })}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-surface hover:text-offwhite"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
