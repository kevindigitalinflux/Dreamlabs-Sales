import { useState } from 'react';
import { AlertCircle, Copy, Phone } from 'lucide-react';
import type { Lead } from '../../types';
import { dueLabel, initials, isDueToday, isOverdue } from '../../lib/utils';
import { STAGE_BORDER_CLASSES } from './stageStyles';

interface LeadCardProps {
  lead: Lead;
  assigneeName?: string | null;
  onOpen?: (lead: Lead) => void;
}

/**
 * Compact lead card (SPEC.md §6): company, phone (tel:), copyable email,
 * next-action indicator when due/overdue, assignee initials chip.
 */
export function LeadCard({ lead, assigneeName, onOpen }: LeadCardProps) {
  const [copied, setCopied] = useState(false);
  const due = lead.next_action_date !== null && (isOverdue(lead.next_action_date) || isDueToday(lead.next_action_date));

  function copyEmail(e: React.MouseEvent) {
    e.stopPropagation();
    if (!lead.email) return;
    void navigator.clipboard.writeText(lead.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(lead)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen?.(lead);
      }}
      className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border border-line border-l-4 bg-card p-3 text-left hover:bg-surface/60 ${STAGE_BORDER_CLASSES[lead.stage]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-heading text-sm font-bold">{lead.business_name}</p>
        {assigneeName && (
          <span aria-label={`Assigned to ${assigneeName}`} title={assigneeName} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple text-[10px] font-bold">
            {initials(assigneeName)}
          </span>
        )}
      </div>
      {lead.phone && (
        <a href={`tel:${lead.phone}`} onClick={(e) => e.stopPropagation()} className="flex min-h-6 items-center gap-1.5 text-sm text-muted hover:text-cyan">
          <Phone className="h-3.5 w-3.5" aria-hidden />
          {lead.phone}
        </a>
      )}
      {lead.email && (
        <button type="button" onClick={copyEmail} title="Copy email" className="flex min-h-6 cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-cyan">
          <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{copied ? 'Copied ✓' : lead.email}</span>
        </button>
      )}
      {due && lead.next_action_date && (
        <p className={`flex items-center gap-1.5 text-xs font-semibold ${isOverdue(lead.next_action_date) ? 'text-red-400' : 'text-cyan'}`}>
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          {dueLabel(lead.next_action_date)}
        </p>
      )}
    </div>
  );
}
