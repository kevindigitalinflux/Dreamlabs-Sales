import { describe, expect, it } from 'vitest';
import {
  computeAutopilotSpendCents, computeEmailStats, computeFunnel, computeLeadsByContractor,
  computeLeadsByStage, computeLeadsByVertical, computeLinkedinSent, computeScraperYield,
  computeSequenceStatusBreakdown, computeWonDeals, inPeriod, periodStart,
} from './analytics';
import type { Lead, LeadNote } from '../types';

const NOW = new Date(2026, 8, 15, 12, 0, 0); // 15 Sept 2026, noon

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: crypto.randomUUID(),
    business_name: 'Acme Ltd', owner_name: null, phone: null, email: null,
    website: null, address: null, city: null, postcode: null,
    google_rating: null, review_count: null, vertical: null,
    stage: 'new_lead', package_tier: null, deal_value: null,
    assigned_to: null, created_by: null, raw_lead_id: null,
    next_action_date: null, next_action_note: null, is_priority: false,
    call_count: 0, last_contacted_at: null, kanban_position: 0,
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function makeNote(overrides: Partial<LeadNote>): LeadNote {
  return {
    id: crypto.randomUUID(), lead_id: 'lead-1', created_by: null,
    content: '', note_type: 'general', ai_extracted_data: null,
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('periodStart / inPeriod', () => {
  it('this_month starts on the 1st of the current month', () => {
    expect(periodStart('this_month', NOW)).toEqual(new Date(2026, 8, 1));
  });
  it('last_30_days is exactly 30 days back', () => {
    const start = periodStart('last_30_days', NOW)!;
    expect(NOW.getTime() - start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });
  it('all_time has no lower bound', () => {
    expect(periodStart('all_time', NOW)).toBeNull();
  });
  it('inPeriod excludes dates before the period start', () => {
    expect(inPeriod('2026-07-31T00:00:00Z', 'this_month', NOW)).toBe(false);
    expect(inPeriod('2026-09-01T00:00:00Z', 'this_month', NOW)).toBe(true);
  });
  it('inPeriod excludes dates after now', () => {
    expect(inPeriod('2026-09-20T00:00:00Z', 'this_month', NOW)).toBe(false);
  });
  it('all_time includes anything up to now', () => {
    expect(inPeriod('2020-01-01T00:00:00Z', 'all_time', NOW)).toBe(true);
  });
});

describe('computeLeadsByStage', () => {
  it('counts leads per stage, all 8 stages present even at 0', () => {
    const leads = [makeLead({ stage: 'contacted' }), makeLead({ stage: 'contacted' }), makeLead({ stage: 'won' })];
    const result = computeLeadsByStage(leads);
    expect(result).toHaveLength(8);
    expect(result.find((r) => r.stage === 'contacted')!.count).toBe(2);
    expect(result.find((r) => r.stage === 'won')!.count).toBe(1);
    expect(result.find((r) => r.stage === 'lost')!.count).toBe(0);
  });
});

describe('computeLeadsByVertical', () => {
  it('groups null vertical under Unspecified, sorted by count desc', () => {
    const leads = [
      makeLead({ vertical: 'Dental' }), makeLead({ vertical: 'Dental' }),
      makeLead({ vertical: null }), makeLead({ vertical: 'Retail' }),
    ];
    const result = computeLeadsByVertical(leads);
    expect(result[0]).toEqual({ vertical: 'Dental', count: 2 });
    expect(result.find((r) => r.vertical === 'Unspecified')!.count).toBe(1);
  });
});

describe('computeLeadsByContractor', () => {
  it('groups unassigned leads under a synthetic bucket, resolves names via the callback', () => {
    const leads = [
      makeLead({ assigned_to: 'u1' }), makeLead({ assigned_to: 'u1' }), makeLead({ assigned_to: null }),
    ];
    const nameFor = (id: string) => (id === 'u1' ? 'Kevin' : id);
    const result = computeLeadsByContractor(leads, nameFor);
    expect(result.find((r) => r.contractorId === 'u1')).toEqual({ contractorId: 'u1', contractorName: 'Kevin', count: 2 });
    expect(result.find((r) => r.contractorId === 'unassigned')).toEqual({ contractorId: 'unassigned', contractorName: 'Unassigned', count: 1 });
  });
});

describe('computeFunnel', () => {
  it('a lead currently at a stage with no history still counts as having reached it', () => {
    const lead = makeLead({ id: 'lead-1', stage: 'proposal_sent' });
    const funnel = computeFunnel([lead], new Map());
    expect(funnel.find((f) => f.stage === 'proposal_sent')!.count).toBe(1);
  });
  it('a lead that regressed after reaching a stage still counts as having reached it', () => {
    const lead = makeLead({ id: 'lead-1', stage: 'lost' });
    const notes = [
      makeNote({ lead_id: 'lead-1', content: 'Stage changed: New Lead → Contacted' }),
      makeNote({ lead_id: 'lead-1', content: 'Stage changed: Contacted → Proposal Sent' }),
      makeNote({ lead_id: 'lead-1', content: 'Stage changed: Proposal Sent → Lost' }),
    ];
    const funnel = computeFunnel([lead], new Map([['lead-1', notes]]));
    expect(funnel.find((f) => f.stage === 'contacted')!.count).toBe(1);
    expect(funnel.find((f) => f.stage === 'proposal_sent')!.count).toBe(1);
    expect(funnel.find((f) => f.stage === 'won')!.count).toBe(0);
  });
  it('a lead still at new_lead with no notes reaches nothing in the funnel', () => {
    const lead = makeLead({ id: 'lead-1', stage: 'new_lead' });
    const funnel = computeFunnel([lead], new Map());
    expect(funnel.every((f) => f.count === 0)).toBe(true);
  });
  it('conversionFromPrevious is null for the first stage, a ratio for the rest', () => {
    const leads = [
      makeLead({ id: 'l1', stage: 'won' }),
      makeLead({ id: 'l2', stage: 'contacted' }),
    ];
    const notes = new Map([
      ['l1', [
        makeNote({ lead_id: 'l1', content: 'Stage changed: New Lead → Contacted' }),
        makeNote({ lead_id: 'l1', content: 'Stage changed: Contacted → Audit Booked' }),
        makeNote({ lead_id: 'l1', content: 'Stage changed: Audit Booked → Proposal Sent' }),
        makeNote({ lead_id: 'l1', content: 'Stage changed: Proposal Sent → Won' }),
      ]],
      ['l2', [
        makeNote({ lead_id: 'l2', content: 'Stage changed: Contacted → Proposal Sent' }),
      ]],
    ]);
    const funnel = computeFunnel(leads, notes);
    expect(funnel[0]!.conversionFromPrevious).toBeNull();
    expect(funnel.find((f) => f.stage === 'contacted')!.count).toBe(2);
    expect(funnel.find((f) => f.stage === 'won')!.conversionFromPrevious).toBe(0.5); // 1 of 2 that reached proposal_sent won
  });
});

describe('computeWonDeals', () => {
  it('only counts leads that transitioned to won within the period, not ones merely currently won', () => {
    const oldWin = makeLead({ id: 'l1', stage: 'won', deal_value: 1000 });
    const newWin = makeLead({ id: 'l2', stage: 'won', deal_value: 2000 });
    const notes = new Map([
      ['l1', [makeNote({ lead_id: 'l1', content: 'Stage changed: Proposal Sent → Won', created_at: '2026-06-01T00:00:00Z' })]],
      ['l2', [makeNote({ lead_id: 'l2', content: 'Stage changed: Proposal Sent → Won', created_at: '2026-09-10T00:00:00Z' })]],
    ]);
    const result = computeWonDeals([oldWin, newWin], notes, 'this_month', NOW);
    expect(result).toEqual({ count: 1, totalValue: 2000 });
  });
  it('a lead currently won with no won-transition note in period is excluded even at all_time if the note predates it', () => {
    const lead = makeLead({ id: 'l1', stage: 'won', deal_value: 500 });
    const notes = new Map([['l1', [] as LeadNote[]]]); // no note at all — e.g. created directly as won
    const result = computeWonDeals([lead], notes, 'all_time', NOW);
    expect(result).toEqual({ count: 0, totalValue: 0 });
  });
});

describe('computeEmailStats', () => {
  it('counts sent emails and replies within the period, computes reply rate', () => {
    const logs = [
      { status: 'sent', sent_at: '2026-09-10T00:00:00Z' },
      { status: 'sent', sent_at: '2026-09-12T00:00:00Z' },
      { status: 'draft', sent_at: '2026-09-12T00:00:00Z' },
      { status: 'sent', sent_at: '2026-07-01T00:00:00Z' }, // outside this_month
    ];
    const replies = [{ received_at: '2026-09-11T00:00:00Z' }];
    const result = computeEmailStats(logs, replies, 'this_month', NOW);
    expect(result).toEqual({ sent: 2, replies: 1, replyRate: 0.5 });
  });
  it('reply rate is 0, not NaN, when nothing was sent', () => {
    expect(computeEmailStats([], [], 'this_month', NOW).replyRate).toBe(0);
  });
});

describe('computeSequenceStatusBreakdown', () => {
  it('always returns all 4 statuses, even at 0', () => {
    const result = computeSequenceStatusBreakdown([{ status: 'active' }, { status: 'active' }]);
    expect(result).toHaveLength(4);
    expect(result.find((r) => r.status === 'active')!.count).toBe(2);
    expect(result.find((r) => r.status === 'paused')!.count).toBe(0);
  });
});

describe('computeLinkedinSent', () => {
  it('counts only sent drafts with sent_at inside the period', () => {
    const drafts = [
      { status: 'sent', sent_at: '2026-09-10T00:00:00Z' },
      { status: 'drafted', sent_at: null },
      { status: 'sent', sent_at: '2026-07-01T00:00:00Z' },
    ];
    expect(computeLinkedinSent(drafts, 'this_month', NOW)).toBe(1);
  });
});

describe('computeScraperYield', () => {
  it('sums results_count and approved_count for jobs created in the period', () => {
    const jobs = [
      { results_count: 40, approved_count: 12, created_at: '2026-09-05T00:00:00Z' },
      { results_count: 20, approved_count: 5, created_at: '2026-07-01T00:00:00Z' },
    ];
    expect(computeScraperYield(jobs, 'this_month', NOW)).toEqual({ found: 40, approved: 12 });
  });
});

describe('computeAutopilotSpendCents', () => {
  it('sums spend for runs started in the period', () => {
    const runs = [
      { actual_ai_cost_cents: 500, started_at: '2026-09-05T00:00:00Z' },
      { actual_ai_cost_cents: 300, started_at: '2026-07-01T00:00:00Z' },
    ];
    expect(computeAutopilotSpendCents(runs, 'this_month', NOW)).toBe(500);
  });
});
