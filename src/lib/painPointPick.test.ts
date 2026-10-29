import { expect, it, vi } from 'vitest';
import { painPointList, validatePainPoint, parseLeadNotesOutput, formatPainPointNote, resolvePainPoint, painPointPrompt } from '../../supabase/functions/_shared/painPointPick';
import { topPainPoint } from '../../supabase/functions/_shared/icp';
import { buildTemplateVars } from './templateVars';
import type { Lead } from '../types';
const points = ['Lost contracts', 'Cleaner cover'];
const pick = { pain_point: 'Cleaner cover', source: 'icp_list' as const, reason: 'The saved notes mention staff cover.' };
it('cleans the existing line/bullet formats, spaces, punctuation and duplicate angles', () => {
  expect(painPointList('\n- Lost contracts\n2. Cleaner   cover\n• lost CONTRACTS\n* Admin — delays')).toEqual(['Lost contracts', 'Cleaner cover', 'Admin, delays']);
});
it('canonicalises case/spacing and normalises the source from list membership', () => {
  expect(validatePainPoint({ ...pick, pain_point: ' cleaner  COVER ' }, points)).toEqual(pick);
  expect(validatePainPoint({ ...pick, source: 'proposed' }, points)).toEqual(pick);
  expect(validatePainPoint({ ...pick, pain_point: 'New angle' }, points)?.source).toBe('proposed');
  expect(validatePainPoint({ ...pick, pain_point: 'New angle', source: 'proposed' }, points)?.source).toBe('proposed');
});
it.each([null, [], {}, { ...pick, pain_point: '' }, { ...pick, reason: '' }, { ...pick, source: 'manual' },
  { ...pick, pain_point: 'x'.repeat(301) }, { ...pick, reason: 'x'.repeat(301) }])('refuses malformed or overlong picks: %j', value => {
  expect(validatePainPoint(value, points)).toBeNull();
});
it('strips AI punctuation and flattens newlines so generated fields cannot inject note headers', () => {
  expect(validatePainPoint({ pain_point: 'Admin — delays', source: 'proposed', reason: 'Saved\nnotes — not guesses' }, points)).toEqual({ pain_point: 'Admin, delays', source: 'proposed', reason: 'Saved notes, not guesses' });
});
it('parses fenced structured notes and keeps bounded talking points alongside the pick', () => {
  const result = parseLeadNotesOutput('```json\n' + JSON.stringify({ talking_points: ['Staff — cover', ' '], choice: pick }) + '\n```', points);
  expect(result).toEqual({ talking_points: ['Staff, cover'], choice: pick });
});
it.each(['not JSON', 'null', '{"talking_points":[]}', '{"choice":{"pain_point":"private lead text"}}'])('falls back safely for malformed output: %s', raw => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const result = parseLeadNotesOutput(raw, points);
  expect(result.choice).toMatchObject({ pain_point: 'Lost contracts', source: 'icp_list' });
  expect(result.choice?.reason).toMatch(/first customer profile/);
  expect(warn).toHaveBeenCalledWith('pain-point pick: invalid notes output; using the saved profile fallback');
  expect(warn.mock.calls.flat().join(' ')).not.toContain('private lead text');
  warn.mockRestore();
});
it('returns no invented choice if the profile list and valid output are both absent', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(parseLeadNotesOutput('{}', []).choice).toBeNull();
  warn.mockRestore();
});
it('round trips structured AI notes through the existing Main pain point line convention', () => {
  const content = formatPainPointNote(pick);
  expect(content).toContain('Main pain point:\nCleaner cover');
  expect(resolvePainPoint([{ content, note_type: 'ai_summary' }], points)).toEqual(pick);
});
it('manual choices always win, even with many newer AI notes; newest manual wins', () => {
  const notes = Array.from({ length: 40 }, () => ({ content: formatPainPointNote(pick), note_type: 'ai_summary' }));
  expect(resolvePainPoint([...notes, { content: 'Main pain point:\nPaperwork', note_type: 'call' },
    { content: 'Main pain point:\nOlder choice', note_type: 'general' }], points)).toEqual({ pain_point: 'Paperwork', source: 'manual', reason: 'Chosen by you.' });
});
it('treats a rep-edited AI note as manual, and ignores unstructured AI text as a manual instruction', () => {
  expect(resolvePainPoint([{ content: formatPainPointNote(pick), note_type: 'ai_summary', edited_at: '2026-10-29' }], points)?.source).toBe('manual');
  expect(resolvePainPoint([{ content: 'Main pain point:\nUnmarked AI', note_type: 'ai_summary' }], points)?.pain_point).toBe('Lost contracts');
});
it('manual formatting marks the change and preserves punctuation typed by the rep', () => {
  const content = formatPainPointNote({ pain_point: 'Admin — cover', source: 'manual', reason: 'Chosen by you.' });
  expect(resolvePainPoint([{ content, note_type: 'general' }], points)).toEqual({ pain_point: 'Admin — cover', source: 'manual', reason: 'Chosen by you.' });
});
it('does not relabel a truncated ICP item as a list match or truncate an existing manual choice', () => {
  expect(painPointList('- ' + 'x'.repeat(301) + '\n- Cover')).toEqual(['Cover']);
  const manual = 'm'.repeat(500);
  expect(resolvePainPoint([{ content: `Main pain point:\n${manual}`, note_type: 'general' }], points)?.pain_point).toBe(manual);
});
it('passes explicit factual fallback and manual precedence instructions to the model', () => {
  const prompt = painPointPrompt(points, { pain_point: 'Paperwork', source: 'manual', reason: 'Chosen by you.' });
  expect(prompt).toContain('Paperwork');
  expect(prompt).toContain('manual choice must win');
  expect(prompt).toContain('first list item');
  expect(prompt).toContain('never invent facts');
});
it('leaves template substitution on the noted pain point or the original first ICP line', () => {
  const first = topPainPoint({ pain_points: '- Admin — cover\n- Lost contracts' });
  const lead = { id: 'fixture', business_name: 'Fixture', owner_name: null, package_tier: null, deal_value: null } as Lead;
  expect(first).toBe('Admin — cover');
  expect(buildTemplateVars(lead, 'Rep', [], first).pain_point).toBe('Admin — cover');
  expect(buildTemplateVars(lead, 'Rep', ['Main pain point:\nManual'], first).pain_point).toBe('Manual');
});
