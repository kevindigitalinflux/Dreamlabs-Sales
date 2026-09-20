import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { groupChangesByLead } from '../../lib/enrichmentGrouping';
import type { EnrichableField, EnrichmentResult, Lead } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

const FIELD_LABELS: Record<EnrichableField, string> = {
  email: 'Email', phone: 'Phone', owner_name: 'Owner',
};
const SOURCE_LABELS: Record<string, string> = {
  website: 'website', companies_house: 'Companies House', opencorporates: 'OpenCorporates',
  hunter: 'Hunter', apollo: 'Apollo',
};

interface EnrichmentReviewProps {
  open: boolean;
  results: EnrichmentResult[];
  leadsById: Record<string, Lead>;
  onClose: () => void;
  onApply: (grouped: Record<string, Partial<Record<EnrichableField, string>>>) => Promise<{ applied: number; failed: { leadId: string; error: string }[] }>;
}

/**
 * Review-before-apply diff panel for bulk enrichment — every proposed field
 * is individually checkable, checked by default; nothing writes until
 * Apply.
 */
export function EnrichmentReview({ open, results, leadsById, onClose, onApply }: EnrichmentReviewProps) {
  const [checked, setChecked] = useState<Record<string, Set<EnrichableField>>>({});
  const [applying, setApplying] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  // Snapshot of each lead's pre-change field values, frozen at the moment
  // `results` arrives. Apply's realtime lead refresh can land before this
  // modal closes, and reading `leadsById` live for the "from" side would
  // then show a field's OLD and NEW value as identical once the real
  // update lands — the from→to diff would read "new@x.com → new@x.com".
  const [fromSnapshot, setFromSnapshot] = useState<Record<string, Partial<Record<EnrichableField, string>>>>({});

  // EnrichmentReview stays mounted for the page's lifetime (Modal just
  // returns null while closed), so a one-time lazy useState initializer
  // would freeze `checked` at whatever `results` was on first mount ([]).
  // Re-derive it from `results` on every new run instead.
  useEffect(() => {
    const initial: Record<string, Set<EnrichableField>> = {};
    const snapshot: Record<string, Partial<Record<EnrichableField, string>>> = {};
    for (const r of results) {
      const fields = Object.keys(r.proposed) as EnrichableField[];
      initial[r.lead_id] = new Set(fields);
      const lead = leadsById[r.lead_id];
      const leadSnapshot: Partial<Record<EnrichableField, string>> = {};
      for (const field of fields) leadSnapshot[field] = (lead?.[field] as string | null) ?? '—';
      snapshot[r.lead_id] = leadSnapshot;
    }
    setChecked(initial);
    setFromSnapshot(snapshot);
    setSummary(null);
    // leadsById intentionally excluded — it changes on every realtime lead
    // update, and this snapshot must only be taken once per `results` run,
    // not re-taken every time the underlying leads refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const changeCount = useMemo(
    () => Object.values(checked).reduce((sum, fields) => sum + fields.size, 0),
    [checked],
  );

  function toggle(leadId: string, field: EnrichableField) {
    setChecked((prev) => {
      const next = { ...prev };
      const fields = new Set(next[leadId]);
      if (fields.has(field)) fields.delete(field); else fields.add(field);
      next[leadId] = fields;
      return next;
    });
  }

  async function handleApply() {
    setApplying(true);
    const grouped = groupChangesByLead(results, checked);
    const { applied, failed } = await onApply(grouped);
    setApplying(false);
    setSummary(failed.length === 0 ? `Updated ${applied} leads` : `Updated ${applied} leads — ${failed.length} failed`);
  }

  return (
    <Modal open={open} onClose={onClose} title="Review found details">
      <div className="flex flex-col gap-4">
        {results.length === 0 && <p className="text-sm text-muted">Nothing found for the selected leads.</p>}
        {results.map((r) => {
          const lead = leadsById[r.lead_id];
          return (
            <div key={r.lead_id} className="rounded-lg border border-line p-3">
              <p className="mb-2 text-sm font-semibold">{lead?.business_name ?? r.lead_id}</p>
              <ul className="flex flex-col gap-1">
                {(Object.keys(r.proposed) as EnrichableField[]).map((field) => {
                  const from = fromSnapshot[r.lead_id]?.[field] ?? '—';
                  const to = r.proposed[field]!;
                  const isChecked = checked[r.lead_id]?.has(field) ?? false;
                  return (
                    <li key={field} className="flex flex-wrap items-center gap-2 rounded bg-surface/60 p-2 text-sm">
                      <input type="checkbox" checked={isChecked} onChange={() => toggle(r.lead_id, field)} className="h-4 w-4 accent-violet-500" aria-label={`Apply ${field} for ${lead?.business_name ?? r.lead_id}`} />
                      <span className="w-16 text-xs font-semibold text-muted">{FIELD_LABELS[field]}</span>
                      <span className="text-muted line-through">{from}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted" aria-hidden />
                      <span className="font-semibold text-success">{to}</span>
                      <span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase text-muted">{SOURCE_LABELS[r.source[field] ?? ''] ?? r.source[field]}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {summary && <p role="status" className="text-sm text-success">{summary}</p>}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>{summary ? 'Close' : 'Cancel'}</Button>
          {!summary && (
            <Button onClick={() => void handleApply()} disabled={applying || changeCount === 0}>
              {applying ? 'Applying…' : `Apply selected (${changeCount})`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
