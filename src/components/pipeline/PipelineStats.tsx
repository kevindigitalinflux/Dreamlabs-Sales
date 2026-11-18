import { isOverdue } from '../../lib/utils';
import type { Lead } from '../../types';

function Tile({ value, label, tone = 'plain' }: { value: number; label: string; tone?: 'plain' | 'attention' }) {
  return (
    <div className="rounded-surface border border-line bg-raised px-4 py-3 shadow-raised">
      <b className={`block font-heading text-2xl font-bold ${tone === 'attention' && value > 0 ? 'text-attention' : ''}`}>{value}</b>
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}

/** Three headline numbers above the list: how many leads, how many follow-ups are overdue, how many are ready to contact. */
export function PipelineStats({ leads }: { leads: Lead[] }) {
  const overdue = leads.filter((l) => isOverdue(l.next_action_date)).length;
  const ready = leads.filter((l) => l.readiness === 'ready').length;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Tile value={leads.length} label="Leads in this pipeline" />
      <Tile value={overdue} label="Follow-ups overdue" tone="attention" />
      <Tile value={ready} label="Ready to contact" />
    </div>
  );
}
