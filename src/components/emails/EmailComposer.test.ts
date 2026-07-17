import { describe, expect, it } from 'vitest';
import { diffLines } from './EmailComposer';

describe('diffLines', () => {
  it('marks unchanged lines same', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { kind: 'same', text: 'a' }, { kind: 'same', text: 'b' },
    ]);
  });
  it('marks additions and removals', () => {
    const d = diffLines('keep\nold line', 'keep\nnew line');
    expect(d).toEqual([
      { kind: 'same', text: 'keep' },
      { kind: 'removed', text: 'old line' },
      { kind: 'added', text: 'new line' },
    ]);
  });
});
