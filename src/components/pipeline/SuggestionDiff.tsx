import { ArrowRight, Sparkles } from 'lucide-react';
import { formatCurrency, packageLabel, PACKAGE_TIERS, stageInfo, STAGES } from '../../lib/utils';
import type { LeadPatch } from '../../lib/leadUpdates';
import type { Lead, LeadSuggestion } from '../../types';
import { Button } from '../ui/Button';

const STAGE_VALUES = new Set(STAGES.map((s) => s.value));
const PACKAGE_TIER_VALUES = new Set(PACKAGE_TIERS.map((t) => t.value));
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT_LEN = 500;

function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function sanitizedString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_LEN) : undefined;
}

/**
 * Whitelist-validates a raw parse-notes response before it ever reaches state or the UI.
 * Unknown shapes, out-of-range enums, and malformed values are dropped field-by-field
 * rather than rejecting the whole suggestion — a partially-useful suggestion is still useful.
 * Returns null only when `raw` isn't a plausible suggestion object at all.
 */
export function sanitizeSuggestion(raw: unknown): LeadSuggestion | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const suggestion: LeadSuggestion = { rationale: 'AI suggestion' };

  if (typeof r.stage === 'string' && STAGE_VALUES.has(r.stage as Lead['stage'])) {
    suggestion.stage = r.stage as LeadSuggestion['stage'];
  }
  if (typeof r.package_tier === 'string' && PACKAGE_TIER_VALUES.has(r.package_tier as NonNullable<Lead['package_tier']>)) {
    suggestion.package_tier = r.package_tier as LeadSuggestion['package_tier'];
  }
  if (typeof r.deal_value === 'number' && Number.isFinite(r.deal_value) && r.deal_value >= 0) {
    suggestion.deal_value = r.deal_value;
  }
  if (typeof r.next_action_date === 'string' && isValidDateOnly(r.next_action_date)) {
    suggestion.next_action_date = r.next_action_date;
  }
  const nextActionNote = sanitizedString(r.next_action_note);
  if (nextActionNote !== undefined) suggestion.next_action_note = nextActionNote;
  const painPoint = sanitizedString(r.pain_point);
  if (painPoint !== undefined) suggestion.pain_point = painPoint;
  const rationale = sanitizedString(r.rationale);
  if (rationale !== undefined) suggestion.rationale = rationale;

  return suggestion;
}

interface SuggestionDiffProps {
  lead: Lead;
  suggestion: LeadSuggestion;
  onApply: (patch: LeadPatch) => void;
  onDismiss: () => void;
}

/** Current → suggested field diff for parse-notes output. Nothing applies without the click. */
export function SuggestionDiff({ lead, suggestion, onApply, onDismiss }: SuggestionDiffProps) {
  const rows: { label: string; from: string; to: string }[] = [];
  if (suggestion.stage && suggestion.stage !== lead.stage) rows.push({ label: 'Stage', from: stageInfo(lead.stage).label, to: stageInfo(suggestion.stage).label });
  if (suggestion.deal_value !== undefined && suggestion.deal_value !== lead.deal_value) rows.push({ label: 'Deal value', from: lead.deal_value !== null ? formatCurrency(lead.deal_value) : '—', to: formatCurrency(suggestion.deal_value) });
  if (suggestion.package_tier && suggestion.package_tier !== lead.package_tier) rows.push({ label: 'Package', from: packageLabel(lead.package_tier), to: packageLabel(suggestion.package_tier) });
  if (suggestion.next_action_date && suggestion.next_action_date !== lead.next_action_date) rows.push({ label: 'Next action date', from: lead.next_action_date ?? '—', to: suggestion.next_action_date });
  if (suggestion.next_action_note && suggestion.next_action_note !== lead.next_action_note) rows.push({ label: 'Next action', from: lead.next_action_note ?? '—', to: suggestion.next_action_note });
  if (suggestion.pain_point) rows.push({ label: 'Pain point (info only)', from: '—', to: suggestion.pain_point });

  function apply() {
    const patch: LeadPatch = {};
    if (suggestion.stage) patch.stage = suggestion.stage;
    if (suggestion.deal_value !== undefined) patch.deal_value = suggestion.deal_value;
    if (suggestion.package_tier) patch.package_tier = suggestion.package_tier;
    if (suggestion.next_action_date) patch.next_action_date = suggestion.next_action_date;
    if (suggestion.next_action_note) patch.next_action_note = suggestion.next_action_note;
    onApply(patch);
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">AI found nothing to update from this note.</p>
        <Button variant="ghost" onClick={onDismiss}>Close</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-cyan" aria-hidden />Suggested updates from your note</p>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.label} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface/60 p-2 text-sm">
            <span className="w-36 text-xs font-semibold text-muted">{r.label}</span>
            <span className="text-muted line-through">{r.from}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted" aria-hidden />
            <span className="font-semibold text-emerald-400">{r.to}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{suggestion.rationale}</p>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onDismiss}>Dismiss</Button>
        <Button onClick={apply}>Apply updates</Button>
      </div>
    </div>
  );
}
