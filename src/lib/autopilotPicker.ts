import { endOfLocalDay, localDateString } from '../../supabase/functions/_shared/autopilotEligibility';
import { filterLeads, type LeadFilters } from './leadFilters';
import { isDueToday, isOverdue } from './utils';
import { setIds, type PickerLead, type PipelineGroup } from './selectableLeads';
import type { Lead, Stage } from '../types';

export type ContactStatus = 'any' | 'never' | 'contacted' | 'due' | 'not_due';
export interface PickerFilters {
  search: string;
  /** null means all, including pipelines loaded later; [] explicitly means none. */
  pipelineIds: string[] | null;
  contact: ContactStatus;
  stages: Stage[];
  readiness: NonNullable<LeadFilters['readiness']>;
  verifiedEmail: boolean;
  hideIneligible: boolean;
  selectedOnly: boolean;
}

/** Fresh filter state, with all pipelines and disabled leads visible. */
export function emptyPickerFilters(): PickerFilters {
  return { search: '', pipelineIds: null, contact: 'any', stages: [], readiness: [], verifiedEmail: false, hideIneligible: false, selectedOnly: false };
}

/** A saved readiness assessment uses checker-valid addresses, never email presence/provider guesses alone. */
export function hasVerifiedEmail(lead: Lead): boolean {
  const addresses = [lead.email, ...(lead.additional_emails ?? []), ...(lead.email_contacts ?? []).filter(c => !c.dismissed_at).map(c => c.email)];
  return !!lead.readiness && Array.isArray(lead.readiness_missing) && !lead.readiness_missing.includes('verified_email')
    && addresses.some(address => !!address?.trim());
}

/** Active sequence dates take precedence; otherwise use the Pipeline's due/overdue date helpers in the run day. */
export function pickerContactStatus(lead: PickerLead, status: ContactStatus, now: Date, timeZone: string): boolean {
  if (status === 'any') return true;
  if (status === 'never') return lead.last_contacted_at == null;
  if (status === 'contacted') return lead.last_contacted_at != null;
  if (lead.enrollment?.status === 'active') {
    const due = lead.enrollment.next_send_at !== null && new Date(lead.enrollment.next_send_at).getTime() <= endOfLocalDay(now, timeZone).getTime();
    return status === 'due' ? due : !due;
  }
  if (!lead.next_action_date) return false;
  const [y, m, d] = localDateString(now, timeZone).split('-').map(Number);
  const runDay = new Date(y!, m! - 1, d!, 12);
  const due = isDueToday(lead.next_action_date, runDay) || isOverdue(lead.next_action_date, runDay);
  return status === 'due' ? due : !due;
}

const normalise = (value: string) => value.trim().replace(/\s+/g, ' ');

/** Combines filters without changing selection, row identities or the submit-time eligible list. */
export function filterPickerGroups(groups: PipelineGroup[], filters: PickerFilters, selected: ReadonlySet<string>, now: Date, timeZone: string): PipelineGroup[] {
  return groups.filter(group => filters.pipelineIds === null || filters.pipelineIds.includes(group.pipelineId)).map(group => {
    // Reuse Pipeline search/stage/readiness logic, normalising whitespace in both query and saved fields.
    const candidates = filters.search.trim() ? group.leads.map(lead => ({ ...lead, business_name: normalise(lead.business_name),
      owner_name: lead.owner_name ? normalise(lead.owner_name) : null, email: lead.email ? normalise(lead.email) : null })) : group.leads;
    const matching = new Set(filterLeads(candidates, { search: normalise(filters.search), stages: filters.stages,
      assignees: [], overdueOnly: false, readiness: filters.readiness }).map(lead => lead.id));
    const leads = group.leads.filter(lead => matching.has(lead.id) && (!filters.hideIneligible || lead.eligible)
      && (!filters.selectedOnly || selected.has(lead.id)) && (!filters.verifiedEmail || hasVerifiedEmail(lead))
      && pickerContactStatus(lead, filters.contact, now, timeZone));
    const visibleIds = new Set(leads.map(lead => lead.id));
    return { ...group, leads, eligible: group.eligible.filter(lead => visibleIds.has(lead.id)) };
  }).filter(group => group.leads.length > 0);
}

/** Adds all filtered eligible rows, keeping picks hidden by filters unchanged. */
export function selectMatching(selected: Set<string>, groups: PipelineGroup[]): Set<string> {
  return setIds(selected, groups.flatMap(group => group.leads.filter(lead => lead.eligible).map(lead => lead.id)), true);
}

/** Counts selections across pipelines, plus selections absent from the filtered results. */
export function selectedSummary(selected: ReadonlySet<string>, all: PipelineGroup[], matching: PipelineGroup[]) {
  const visible = new Set(matching.flatMap(group => group.leads.map(lead => lead.id)));
  const picks = all.flatMap(group => group.leads).filter(lead => selected.has(lead.id));
  return { count: picks.length, pipelines: new Set(picks.map(lead => lead.pipeline_id)).size, hidden: picks.filter(lead => !visible.has(lead.id)).length };
}

/** Short, visible explanations for every classifier/parked-review outcome. */
export function pickerReason(lead: PickerLead, now: Date): string {
  switch (lead.reason) {
    case 'new': return 'Ready to pick';
    case 'due': return 'Due today or overdue';
    case 'replied': return 'Replied';
    case 'opted_out': return 'Opted out';
    case 'blocked': return 'On the blocklist';
    case 'closed': return 'Already won or lost';
    case 'paused': return 'Sequence paused';
    case 'not_due': return 'Not due yet';
    case 'pending_review': return 'Has an email waiting for review';
    case 'recently_contacted': {
      const days = Math.max(0, Math.floor((now.getTime() - new Date(lead.last_contacted_at!).getTime()) / 86_400_000));
      return days === 0 ? 'Contacted today' : `Contacted ${days} ${days === 1 ? 'day' : 'days'} ago`;
    }
  }
}
