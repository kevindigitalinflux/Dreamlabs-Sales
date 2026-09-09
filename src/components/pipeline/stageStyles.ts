import {
  CalendarCheck, Clock, FileText, Handshake, PhoneCall, Sparkles, Trophy, XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Stage } from '../../types';

/** Badge colour classes per stage — theme-aware tokens (src/index.css), each pair
 * verified via WCAG contrast calculation to clear 4.5:1 in light mode and matching
 * the app's original dark-mode hues via the [data-theme="dark"] override. */
export const STAGE_BADGE_CLASSES: Record<Stage, string> = {
  new_lead: 'bg-stage-new-lead/15 text-stage-new-lead',
  contacted: 'bg-stage-contacted/15 text-stage-contacted',
  audit_booked: 'bg-stage-audit-booked/15 text-stage-audit-booked',
  proposal_sent: 'bg-stage-proposal-sent/15 text-stage-proposal-sent',
  negotiating: 'bg-stage-negotiating/15 text-stage-negotiating',
  won: 'bg-stage-won/15 text-stage-won',
  lost: 'bg-stage-lost/15 text-stage-lost',
  not_now_nurture: 'bg-stage-nurture/25 text-stage-nurture',
};

/** Card left-border colour classes per stage. */
export const STAGE_BORDER_CLASSES: Record<Stage, string> = {
  new_lead: 'border-l-[#94A3B8]',
  contacted: 'border-l-[#8B32FF]',
  audit_booked: 'border-l-[#00DFDF]',
  proposal_sent: 'border-l-[#F59E0B]',
  negotiating: 'border-l-[#F97316]',
  won: 'border-l-[#22C55E]',
  lost: 'border-l-[#EF4444]',
  not_now_nurture: 'border-l-[#64378B]',
};

/** One icon per stage — every stage indicator is icon + colour + label, never colour alone. */
export const STAGE_ICONS: Record<Stage, LucideIcon> = {
  new_lead: Sparkles,
  contacted: PhoneCall,
  audit_booked: CalendarCheck,
  proposal_sent: FileText,
  negotiating: Handshake,
  won: Trophy,
  lost: XCircle,
  not_now_nurture: Clock,
};
