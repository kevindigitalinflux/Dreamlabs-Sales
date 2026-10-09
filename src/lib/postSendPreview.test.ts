import { describe, expect, it } from 'vitest';
import { buildPostSendPreview, mergePostSend, parsePostSend } from './postSendPreview';

const base = {
  orgId: 'o1', templateId: 't1',
  templates: [{ id: 't1', org_id: 'o1', template_type: 'cold_outreach', is_default: true }],
  sequences: [{ id: 's1', name: 'Cold outreach', steps: [{ delay_days: 0, template_type: 'cold_outreach' }, { delay_days: 3, template_type: 'follow_up' }] }],
  enrollment: null, currentNextActionDate: null, todayLocal: '2026-10-09', now: new Date('2026-10-09T10:00:00Z'),
  subject: 'Hi', recipientLabel: 'a@b.co',
};

describe('buildPostSendPreview', () => {
  it('returns null with no template or an unknown template', () => {
    expect(buildPostSendPreview({ ...base, templateId: '' })).toBeNull();
    expect(buildPostSendPreview({ ...base, templateId: 'zzz' })).toBeNull();
  });
  it('describes an enrol and a follow-up', () => {
    const lines = buildPostSendPreview(base);
    expect(lines?.[0]).toBe('Enrols the lead in Cold outreach at step 2 of 2');
    expect(lines?.[1]).toBe('Follow-up set for 2026-10-12');
  });
  it('keeps a future next action date', () => {
    const lines = buildPostSendPreview({ ...base, currentNextActionDate: '2026-11-01' });
    expect(lines?.[1]).toBe('Your existing next action date is kept');
  });
});

describe('parsePostSend / mergePostSend', () => {
  it('parses a good shape and ignores junk', () => {
    expect(parsePostSend({ post_send: { lines: ['a', 1], warnings: ['w'] } })).toEqual({ lines: ['a'], warnings: ['w'] });
    expect(parsePostSend({ ok: true })).toBeNull();
    expect(parsePostSend(null)).toBeNull();
    expect(parsePostSend({ post_send: { lines: [], warnings: [] } })).toBeNull();
  });
  it('merges and dedupes', () => {
    expect(mergePostSend([{ lines: ['a'], warnings: [] }, null, { lines: ['a', 'b'], warnings: ['w'] }])).toEqual({ lines: ['a', 'b'], warnings: ['w'] });
    expect(mergePostSend([null])).toBeNull();
  });
});
