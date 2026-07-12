import {
  CalendarCheck, Clock, FileText, Handshake, PhoneCall, Sparkles, Trophy, XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Stage } from '../../types';

/** Badge colour classes per stage — literal strings so Tailwind can compile them. */
export const STAGE_BADGE_CLASSES: Record<Stage, string> = {
  new_lead: 'bg-[#94A3B8]/15 text-[#94A3B8]',
  contacted: 'bg-[#8B32FF]/15 text-[#B57BFF]',
  audit_booked: 'bg-[#00DFDF]/15 text-[#00DFDF]',
  proposal_sent: 'bg-[#F59E0B]/15 text-[#F59E0B]',
  negotiating: 'bg-[#F97316]/15 text-[#F97316]',
  won: 'bg-[#22C55E]/15 text-[#22C55E]',
  lost: 'bg-[#EF4444]/15 text-[#EF4444]',
  not_now_nurture: 'bg-[#64378B]/25 text-[#C9A6E8]',
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
