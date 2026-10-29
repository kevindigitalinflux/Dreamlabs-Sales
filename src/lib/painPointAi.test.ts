import { afterEach, expect, it, vi } from 'vitest';
import { generateLeadNotes, draftEmailClaude, draftEmail } from '../../supabase/functions/_shared/ai';
const choice = { pain_point: 'Cleaner cover', source: 'icp_list' as const, reason: 'The saved lead notes mention cover.' };
const requests: Record<string, unknown>[] = [];
function respond(text: string) {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', candidates: [{ content: { parts: [{ text }] } }] }));
  }));
}
afterEach(() => { vi.unstubAllGlobals(); requests.length = 0; vi.restoreAllMocks(); });
it('uses one existing Sonnet notes call for structured choice plus talking points', async () => {
  respond(JSON.stringify({ talking_points: ['Cover matters'], choice }));
  const text = await generateLeadNotes({ lead: { business_name: 'Fixture' }, icpParams: null, painPoints: ['Lost contracts', 'Cleaner cover'], apiKey: 'fake-local' });
  expect(text).toContain('Main pain point:\nCleaner cover');
  expect(text).toContain('The saved lead notes mention cover.');
  expect(text).toContain('Cover matters');
  expect(requests).toHaveLength(1);
  expect(requests[0]?.model).toBe('claude-sonnet-5');
});
it('does not retry malformed notes or log returned lead text, and falls back to the first angle', async () => {
  respond('private bad model output');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const text = await generateLeadNotes({ lead: {}, icpParams: null, painPoints: ['Lost contracts'], apiKey: 'fake-local' });
  expect(text).toContain('Main pain point:\nLost contracts');
  expect(requests).toHaveLength(1);
  expect(warn.mock.calls.flat().join(' ')).not.toContain('private bad');
});
const draft = { subject: 'Hello', body: 'A draft', lead: {}, notes: [], contractorName: 'Rep', orgName: 'Fixture', apiKey: 'fake-local' };
it('keeps Haiku drafts focused on the chosen reason and parses the same-call choice', async () => {
  respond(JSON.stringify({ subject: 'Hello', body: 'Cover help', choice }));
  const result = await draftEmailClaude({ ...draft, model: 'claude-haiku-4-5', painPoints: ['Cleaner cover'], painPoint: choice });
  expect(result.painPoint).toEqual(choice);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.model).toBe('claude-haiku-4-5');
  expect(JSON.stringify(requests)).toContain('Build the email around the chosen pain point and reason');
});
it('passes a manual choice unchanged even if the drafting model proposes another', async () => {
  respond(JSON.stringify({ subject: 'Hello', body: 'Manual draft', choice }));
  const manual = { pain_point: 'Admin', source: 'manual' as const, reason: 'Chosen by you.' };
  const result = await draftEmail({ ...draft, painPoints: ['Cleaner cover'], painPoint: manual });
  expect(result.painPoint).toEqual(manual);
  expect(requests).toHaveLength(1);
});
