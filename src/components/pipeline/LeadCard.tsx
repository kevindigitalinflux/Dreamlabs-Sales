import { useState } from 'react';
import { AlertCircle, ChevronDown, Copy } from 'lucide-react';
import { PhoneChip } from './PhoneChip';
import { parsePhone } from '../../../supabase/functions/_shared/phoneNumbers';
import type { Lead } from '../../types';
import { dueLabel, initials, isDueToday, isOverdue } from '../../lib/utils';
import { STAGE_BORDER_CLASSES } from './stageStyles';
import { ReadinessBadge } from './ReadinessBadge';

interface LeadCardProps {
  lead: Lead;
  assigneeName?: string | null;
  onOpen?: (lead: Lead) => void;
  /** Show the details (readiness, phone, email, due date). Collapsed cards show only the name and a due marker. */
  expanded?: boolean;
  /** When set, the card shows a chevron that expands and collapses its details. */
  onToggleExpanded?: () => void;
}

/**
 * Pipeline board card. Collapsed it is one tidy block (name, assignee, and a marker when a follow-up is due), so it
 * always fits its column; expanded it also shows readiness, phone, a copyable email and the next action.
 */
export function LeadCard({ lead, assigneeName, onOpen, expanded = false, onToggleExpanded }: LeadCardProps) {
  const [copied, setCopied] = useState(false);
  const overdue = isOverdue(lead.next_action_date);
  const due = lead.next_action_date !== null && (overdue || isDueToday(lead.next_action_date));

  function copyEmail(e: React.MouseEvent) {
    e.stopPropagation();
    if (!lead.email) return;
    void navigator.clipboard.writeText(lead.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`flex min-w-0 flex-col rounded-nested border border-line border-l-4 bg-raised text-left shadow-raised ${STAGE_BORDER_CLASSES[lead.stage]}`}>
      <div className="flex items-start">
        <button
          type="button"
          onClick={() => onOpen?.(lead)}
          className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col gap-1 rounded-nested p-2.5 text-left hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus"
        >
          <span className="line-clamp-2 break-words font-heading text-sm font-bold leading-snug">{lead.business_name}</span>
          {(due || assigneeName) && (
            <span className="flex flex-wrap items-center gap-1.5">
              {due && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${overdue ? 'bg-attention-soft text-attention' : 'bg-violet-soft text-link'}`}>
                  <AlertCircle className="h-3 w-3" aria-hidden />{overdue ? 'Overdue' : 'Due today'}
                </span>
              )}
              {assigneeName && (
                <span aria-label={`Assigned to ${assigneeName}`} title={assigneeName} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple text-[10px] font-bold text-on-accent">{initials(assigneeName)}</span>
              )}
            </span>
          )}
        </button>
        {onToggleExpanded && (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} details for ${lead.business_name}`}
            className="flex h-11 w-9 shrink-0 cursor-pointer items-center justify-center rounded-nested text-muted hover:bg-surface hover:text-offwhite focus-visible:outline-2 focus-visible:outline-focus"
          >
            <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        )}
      </div>
      {expanded && (
        <div className="flex min-w-0 flex-col gap-2 border-t border-line p-2.5">
          <ReadinessBadge compact readiness={lead.readiness} missing={lead.readiness_missing} />
          {lead.phone && <PhoneChip value={lead.phone} country={lead.country} metadata={lead.phone_meta?.[parsePhone(lead.phone, lead.country)?.value ?? '']} />}
          {lead.email && (
            <button type="button" onClick={copyEmail} title="Copy email" className="flex min-h-8 min-w-0 cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-link">
              <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{copied ? 'Copied ✓' : lead.email}</span>
            </button>
          )}
          {lead.next_action_date && <p className={`text-xs font-semibold ${overdue ? 'text-attention' : 'text-muted'}`}>{dueLabel(lead.next_action_date)}</p>}
        </div>
      )}
    </div>
  );
}
