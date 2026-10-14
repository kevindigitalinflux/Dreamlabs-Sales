import { describe, expect, it } from 'vitest';
import { readSeen, SEEN_MAX, writeSeen, type StorageLike } from './seen';

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
};

describe('seen storage', () => {
  it('round-trips per organisation', () => {
    const s = memory();
    writeSeen(s, 'org-a', new Set(['x@1', 'y@2']));
    expect([...readSeen(s, 'org-a')]).toEqual(['x@1', 'y@2']);
    expect(readSeen(s, 'org-b').size).toBe(0);
  });
  it('treats corrupt, wrong-shaped or missing data as nothing seen', () => {
    const s = memory();
    s.setItem('dreamlabs.jobs.seen.o', '{not json');
    expect(readSeen(s, 'o').size).toBe(0);
    s.setItem('dreamlabs.jobs.seen.o', JSON.stringify({ a: 1 }));
    expect(readSeen(s, 'o').size).toBe(0);
    s.setItem('dreamlabs.jobs.seen.o', JSON.stringify(['ok', 5, null, 'also ok']));
    expect([...readSeen(s, 'o')]).toEqual(['ok', 'also ok']);
    expect(readSeen(memory(), 'o').size).toBe(0);
  });
  it('works without a storage and survives a storage that throws', () => {
    expect(readSeen(null, 'o').size).toBe(0);
    expect(() => writeSeen(null, 'o', new Set(['a']))).not.toThrow();
    const boom: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readSeen(boom, 'o').size).toBe(0);
    expect(() => writeSeen(boom, 'o', new Set(['a']))).not.toThrow();
  });
  it('keeps only the newest entries when there are too many', () => {
    const s = memory();
    const many = new Set(Array.from({ length: SEEN_MAX + 25 }, (_, i) => `k${i}@t`));
    writeSeen(s, 'o', many);
    const back = [...readSeen(s, 'o')];
    expect(back).toHaveLength(SEEN_MAX);
    expect(back[back.length - 1]).toBe(`k${SEEN_MAX + 24}@t`);
    expect(back[0]).toBe('k25@t');
  });
});
