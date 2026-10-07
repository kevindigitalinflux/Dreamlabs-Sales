import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { RunLeadRow as RunLeadRowData } from '../../hooks/useAutopilotRunLeads';

/** One lead in a selected run: its name (linked to the lead page) and the plain-English reason. */
export function RunLeadRow({ row, action }: { row: RunLeadRowData; action?: ReactNode }) {
  const name = row.lead?.business_name ?? 'Lead no longer available';
  return (
    <li className="flex flex-col gap-1 rounded-lg bg-surface/50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {row.lead
          ? <Link to={`/pipeline/leads/${row.lead.id}`} className="font-semibold text-cyan hover:underline">{name}</Link>
          : <span className="font-semibold">{name}</span>}
        {row.reason && <p className="text-muted">{row.reason}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}
