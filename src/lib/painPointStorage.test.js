import { expect, it, vi } from 'vitest';
import { loadPainPointNotes, saveAiPainPoint, saveGeneratedPainPointNotes } from '../../supabase/functions/_shared/painPointStorage';
import { formatPainPointNote } from '../../supabase/functions/_shared/painPointPick';
const pick = { pain_point: 'Cover', source: 'proposed', reason: 'The saved notes mention cover.' };
function client(notes, error = null) {
  const inserted = [];
  const ranges = [];
  const service = { from: vi.fn(table => {
    expect(table).toBe('lead_notes');
    const query = { select() { return this; }, eq(key, id) { expect([key, id]).toEqual(['lead_id', 'lead']); return this; }, order() { return this; },
      async range(start, end) { ranges.push([start, end]); return { data: notes.slice(start, end + 1), error }; },
      async insert(row) { inserted.push(row); return { error }; } };
    return query;
  }) };
  return { service, inserted, ranges };
}
it('reads past one page so an old manual choice cannot be replaced by a newer AI pick', async () => {
  const notes = [...Array.from({ length: 1000 }, () => ({ content: 'Recent note', note_type: 'general' })),
    { content: 'Main pain point:\nPaperwork', note_type: 'call' }];
  const fake = client(notes);
  expect(await loadPainPointNotes(fake.service, 'lead')).toHaveLength(1001);
  const result = await saveAiPainPoint(fake.service, 'lead', pick);
  expect(result).toMatchObject({ pain_point: 'Paperwork', source: 'manual' });
  expect(fake.inserted).toEqual([]);
  expect(fake.ranges).toContainEqual([1000, 1999]);
});
it('appends one provenance note, never updates a manual row, and skips an identical cached pick', async () => {
  const fake = client([]);
  await saveAiPainPoint(fake.service, 'lead', pick);
  expect(fake.inserted).toEqual([{ lead_id: 'lead', created_by: null, note_type: 'ai_summary', content: formatPainPointNote(pick) }]);
  const cached = client([{ content: formatPainPointNote(pick), note_type: 'ai_summary' }]);
  await saveAiPainPoint(cached.service, 'lead', pick);
  expect(cached.inserted).toEqual([]);
});
it('rechecks manual precedence before storing generated talking points', async () => {
  const fake = client([{ content: 'Main pain point:\nManual', note_type: 'general' }]);
  const text = await saveGeneratedPainPointNotes(fake.service, 'lead', formatPainPointNote(pick) + '\n\nTalking points:\nUseful context');
  expect(text).toBe('Talking points:\nUseful context');
  expect(fake.inserted[0].content).not.toContain('Main pain point:');
});
it('fails closed on read/write errors without leaking database details', async () => {
  const fake = client([], { message: 'private database detail' });
  await expect(loadPainPointNotes(fake.service, 'lead')).rejects.toThrow('Could not load pain point notes');
  await expect(saveAiPainPoint(fake.service, 'lead', pick)).rejects.toThrow('Could not load pain point notes');
});
