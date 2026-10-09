import { describe, expect, it, vi } from 'vitest';
import { savePhoneAfterLookup } from './knownPersonPhone';
import type { DecisionMakerCandidate } from '../types';

const row = (phone: string | null) => ({ id: 'c1', kind: 'person', first_name: 'A', last_name: 'M', phone } as DecisionMakerCandidate);

describe('savePhoneAfterLookup', () => {
  it('does nothing without a typed phone', async () => {
    const update = vi.fn();
    expect(await savePhoneAfterLookup('', 'c1', [row(null)], update)).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });
  it('saves the typed phone into a blank row', async () => {
    const update = vi.fn().mockResolvedValue({ error: null });
    expect(await savePhoneAfterLookup('0123', 'c1', [row(null)], update)).toEqual([]);
    expect(update.mock.calls[0][1].phone).toBe('0123');
  });
  it('keeps a provider phone and says so', async () => {
    const update = vi.fn();
    const notes = await savePhoneAfterLookup('0123', 'c1', [row('999')], update);
    expect(notes).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
  });
  it('reports a failed save as a note, never an error', async () => {
    const update = vi.fn().mockResolvedValue({ error: 'Phone has bad characters' });
    expect(await savePhoneAfterLookup('0123', 'c1', [row(null)], update))
      .toEqual(['Saved, but the phone number could not be saved: Phone has bad characters']);
  });
  it('notes a missing row', async () => {
    const notes = await savePhoneAfterLookup('0123', 'c1', null, vi.fn());
    expect(notes[0]).toContain('Saved, but the phone number could not be saved');
  });
});
