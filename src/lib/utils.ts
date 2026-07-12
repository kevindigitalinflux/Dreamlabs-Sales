import type { PackageTier, Stage } from '../types';

export interface StageInfo {
  value: Stage;
  label: string;
  hex: string;
}

/** All pipeline stages in spec order with their brand colours (SPEC.md §6). */
export const STAGES: StageInfo[] = [
  { value: 'new_lead', label: 'New Lead', hex: '#94A3B8' },
  { value: 'contacted', label: 'Contacted', hex: '#8B32FF' },
  { value: 'audit_booked', label: 'Audit Booked', hex: '#00DFDF' },
  { value: 'proposal_sent', label: 'Proposal Sent', hex: '#F59E0B' },
  { value: 'negotiating', label: 'Negotiating', hex: '#F97316' },
  { value: 'won', label: 'Won', hex: '#22C55E' },
  { value: 'lost', label: 'Lost', hex: '#EF4444' },
  { value: 'not_now_nurture', label: 'Not Now / Nurture', hex: '#64378B' },
];

/** Looks up the StageInfo for a stage value. Throws on unknown stages. */
export function stageInfo(stage: Stage): StageInfo {
  const info = STAGES.find((s) => s.value === stage);
  if (!info) throw new Error(`Unknown stage: ${stage as string}`);
  return info;
}

/** All package tiers with display labels (SPEC.md §3 leads.package_tier). */
export const PACKAGE_TIERS: { value: PackageTier; label: string }[] = [
  { value: 'pilot_systems', label: 'Pilot — Systems' },
  { value: 'pilot_ai_app', label: 'Pilot — AI App' },
  { value: 'pilot_full_build', label: 'Pilot — Full Build' },
  { value: 'automation_sprint', label: 'Automation Sprint' },
  { value: 'ai_foundation', label: 'AI Foundation' },
  { value: 'full_build', label: 'Full Build' },
  { value: 'retainer_bronze', label: 'Retainer — Bronze' },
  { value: 'retainer_silver', label: 'Retainer — Silver' },
  { value: 'retainer_gold', label: 'Retainer — Gold' },
  { value: 'custom', label: 'Custom' },
];

/** Display label for a package tier; em dash for none. */
export function packageLabel(tier: PackageTier | null): string {
  if (!tier) return '—';
  return PACKAGE_TIERS.find((t) => t.value === tier)?.label ?? tier;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parses a DATE column value ('YYYY-MM-DD') as a local date, not UTC. */
function parseDateOnly(dateISO: string): Date {
  const [y, m, d] = dateISO.slice(0, 10).split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

const MS_PER_DAY = 86_400_000;

/** Whole days a date is past due; 0 if due today or in the future. */
export function daysOverdue(dateISO: string, today: Date = new Date()): number {
  const diff = (startOfDay(today).getTime() - parseDateOnly(dateISO).getTime()) / MS_PER_DAY;
  return Math.max(0, Math.round(diff));
}

/** True when the date is strictly before today. */
export function isOverdue(dateISO: string | null, today: Date = new Date()): boolean {
  return dateISO !== null && daysOverdue(dateISO, today) > 0;
}

/** True when the date is exactly today. */
export function isDueToday(dateISO: string | null, today: Date = new Date()): boolean {
  if (dateISO === null) return false;
  return parseDateOnly(dateISO).getTime() === startOfDay(today).getTime();
}

/** Human label for a next-action date: "2 days overdue" | "Due today" | "Due tomorrow" | "Due in N days". */
export function dueLabel(dateISO: string, today: Date = new Date()): string {
  const overdue = daysOverdue(dateISO, today);
  if (overdue === 1) return '1 day overdue';
  if (overdue > 1) return `${overdue} days overdue`;
  if (isDueToday(dateISO, today)) return 'Due today';
  const inDays = Math.round((parseDateOnly(dateISO).getTime() - startOfDay(today).getTime()) / MS_PER_DAY);
  return inDays === 1 ? 'Due tomorrow' : `Due in ${inDays} days`;
}

/** "12 Jul 2026" — UK short date for any ISO date or timestamp string. */
export function formatShortDate(iso: string): string {
  const d = iso.length <= 10 ? parseDateOnly(iso) : new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole-pound GBP: 1200 → "£1,200". */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
  }).format(value);
}

/** Up-to-two-letter initials for avatar chips; "?" when no name. */
export function initials(name: string | null | undefined): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}
