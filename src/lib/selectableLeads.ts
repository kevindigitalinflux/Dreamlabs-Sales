import { classifyLead, localDateString, windowBounds, type EligibilityEnrollment } from '../../supabase/functions/_shared/autopilotEligibility';
import type { Lead, Pipeline } from '../types';

export type SelectableLead = Lead & { reason: 'new' | 'due' };

export interface PipelineGroup {
  pipelineId: string;
  pipelineName: string;
  eligible: SelectableLead[];
  hiddenCount: number;
}

/**
 * Groups leads by pipeline, keeping only those autopilot may act on now. Ineligible leads are
 * counted in `hiddenCount`. Pipelines with no leads at all are omitted. `endOfToday` must come
 * from `endOfLocalDay(now, timeZone)`.
 */
export function groupSelectableLeads(
  pipelines: Pipeline[],
  leads: Lead[],
  enrollmentByLead: Map<string, EligibilityEnrollment>,
  blocked: Set<string>,
  endOfToday: Date,
  now: Date,
): PipelineGroup[] {
  const groups: PipelineGroup[] = [];
  for (const p of pipelines) {
    const eligible: SelectableLead[] = [];
    let hiddenCount = 0;
    let total = 0;
    for (const lead of leads) {
      if (lead.pipeline_id !== p.id) continue;
      total += 1;
      const res = classifyLead({ ...lead, opted_out: lead.opted_out === true }, enrollmentByLead.get(lead.id) ?? null, blocked, endOfToday, now);
      if (res.eligible) eligible.push({ ...lead, reason: res.reason });
      else hiddenCount += 1;
    }
    if (total > 0) groups.push({ pipelineId: p.id, pipelineName: p.name, eligible, hiddenCount });
  }
  return groups;
}

/** Whether none, some or all of the given ids are in the selection (drives the indeterminate checkbox). */
export function selectionState(ids: string[], selected: Set<string>): 'none' | 'some' | 'all' {
  if (ids.length === 0) return 'none';
  const n = ids.filter((id) => selected.has(id)).length;
  return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
}

/** A new selection with every id added (select) or removed (deselect). */
export function setIds(selected: Set<string>, ids: string[], on: boolean): Set<string> {
  const next = new Set(selected);
  for (const id of ids) { if (on) next.add(id); else next.delete(id); }
  return next;
}

/**
 * Error message for a sending window starting today in the given zone, or null when valid.
 * Rejects empty times, an unknown timezone, a finish not after the start, and a finish already past.
 */
export function validateWindow(start: string, end: string, timeZone: string, now: Date): string | null {
  if (!start || !end) return 'Choose a start and finish time';
  try {
    const bounds = windowBounds(localDateString(now, timeZone), start, end, timeZone);
    if (!bounds) return 'Finish time must be after start time';
    if (bounds.endUtc.getTime() <= now.getTime()) return 'Finish time has already passed today';
    return null;
  } catch {
    return 'Choose a valid timezone';
  }
}

/** Ids that are both selected and currently eligible (visible) in the picker. Stale or other-org ids are dropped. */
export function pruneSelection(selected: Set<string>, groups: PipelineGroup[]): string[] {
  const out: string[] = [];
  for (const g of groups) for (const l of g.eligible) if (selected.has(l.id)) out.push(l.id);
  return out;
}

/** Readable message for a failed autopilot_runs insert (unique index: one active run per mode per org). */
export function mapRunInsertError(err: { code?: string; message: string }): string {
  if (err.code === '23505' || err.message.includes('autopilot_runs_one_active_per_org_mode')) {
    return 'You already have a selected-leads run in progress. Let it finish or stop it before starting another.';
  }
  return err.message;
}

/** Validates the daily send cap (positive whole number) and spend cap (empty, 0, or a positive number). */
export function validateCaps(dailySendCap: number, spendCap: string): string | null {
  if (!Number.isInteger(dailySendCap) || dailySendCap < 1) return 'Daily sends must be a whole number of at least 1';
  const t = spendCap.trim();
  if (t !== '' && !(Number.isFinite(Number(t)) && Number(t) >= 0)) return 'Spend cap must be a positive number, or empty for no cap';
  return null;
}

/** Spend cap in cents, or null for no cap (empty or 0 never means a zero-cent cap). */
export function spendCapToCents(spendCap: string): number | null {
  const n = Number(spendCap.trim());
  return spendCap.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : Math.round(n * 100);
}
