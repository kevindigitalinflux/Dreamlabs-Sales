import type { Lead, Stage } from '../types';
import { parsePhone } from '../../supabase/functions/_shared/phoneNumbers';

export interface DialerFilters {
  stages: Stage[];
  notCalledInDays: 'any' | 7 | 14 | 30;
  assignedToMeOnly: boolean;
}

function daysSince(dateISO: string, today: Date): number {
  const ms = today.getTime() - new Date(dateISO).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/** Leads a power dialer session could call: must have a phone number, plus the given filters. Empty `stages` means "all stages". */
export function filterDialableLeads(
  leads: Lead[],
  filters: DialerFilters,
  currentUserId: string | undefined,
  today: Date = new Date(),
): Lead[] {
  return leads.flatMap((lead) => {
    const phone = parsePhone(lead.phone, lead.country);
    if (!phone) return [];
    if (filters.stages.length > 0 && !filters.stages.includes(lead.stage)) return [];
    if (filters.assignedToMeOnly && lead.assigned_to !== currentUserId) return [];
    if (filters.notCalledInDays !== 'any') {
      if (lead.last_contacted_at && daysSince(lead.last_contacted_at, today) < filters.notCalledInDays) return [];
    }
    return [{ ...lead, phone: phone.value }];
  });
}
