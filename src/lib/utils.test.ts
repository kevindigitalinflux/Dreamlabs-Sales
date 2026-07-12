import { describe, expect, it } from 'vitest';
import {
  STAGES, stageInfo, PACKAGE_TIERS, packageLabel,
  daysOverdue, isOverdue, isDueToday, dueLabel,
  formatShortDate, formatCurrency, initials,
} from './utils';

const TODAY = new Date(2026, 6, 12); // 12 Jul 2026 (local)

describe('stages', () => {
  it('has all 8 pipeline stages in spec order', () => {
    expect(STAGES.map((s) => s.value)).toEqual([
      'new_lead', 'contacted', 'audit_booked', 'proposal_sent',
      'negotiating', 'won', 'lost', 'not_now_nurture',
    ]);
  });
  it('has unique hex colours', () => {
    expect(new Set(STAGES.map((s) => s.hex)).size).toBe(8);
  });
  it('stageInfo returns the right entry', () => {
    expect(stageInfo('won')).toEqual({ value: 'won', label: 'Won', hex: '#22C55E' });
  });
});

describe('package tiers', () => {
  it('has all 10 tiers', () => {
    expect(PACKAGE_TIERS).toHaveLength(10);
  });
  it('packageLabel handles null', () => {
    expect(packageLabel(null)).toBe('—');
    expect(packageLabel('retainer_gold')).toBe('Retainer — Gold');
  });
});

describe('overdue logic', () => {
  it('daysOverdue is 0 for today and future dates', () => {
    expect(daysOverdue('2026-07-12', TODAY)).toBe(0);
    expect(daysOverdue('2026-07-20', TODAY)).toBe(0);
  });
  it('daysOverdue counts whole days past due', () => {
    expect(daysOverdue('2026-07-10', TODAY)).toBe(2);
    expect(daysOverdue('2026-07-11', TODAY)).toBe(1);
  });
  it('isOverdue: past yes, today no, null no', () => {
    expect(isOverdue('2026-07-10', TODAY)).toBe(true);
    expect(isOverdue('2026-07-12', TODAY)).toBe(false);
    expect(isOverdue(null, TODAY)).toBe(false);
  });
  it('isDueToday', () => {
    expect(isDueToday('2026-07-12', TODAY)).toBe(true);
    expect(isDueToday('2026-07-11', TODAY)).toBe(false);
    expect(isDueToday(null, TODAY)).toBe(false);
  });
  it('dueLabel variants', () => {
    expect(dueLabel('2026-07-10', TODAY)).toBe('2 days overdue');
    expect(dueLabel('2026-07-11', TODAY)).toBe('1 day overdue');
    expect(dueLabel('2026-07-12', TODAY)).toBe('Due today');
    expect(dueLabel('2026-07-13', TODAY)).toBe('Due tomorrow');
    expect(dueLabel('2026-07-15', TODAY)).toBe('Due in 3 days');
  });
});

describe('formatting', () => {
  it('formatShortDate', () => {
    expect(formatShortDate('2026-07-12')).toBe('12 Jul 2026');
  });
  it('formatCurrency uses GBP with no decimals', () => {
    expect(formatCurrency(1200)).toBe('£1,200');
  });
  it('initials', () => {
    expect(initials('Eszter Kovacs')).toBe('EK');
    expect(initials('Kevin')).toBe('K');
    expect(initials(null)).toBe('?');
  });
});
