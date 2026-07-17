import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('joins headers and rows with CRLF', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toBe('a,b\r\n1,2');
  });
  it('quotes cells containing commas, quotes or newlines', () => {
    expect(toCsv(['x'], [['hello, world']])).toBe('x\r\n"hello, world"');
    expect(toCsv(['x'], [['say "hi"']])).toBe('x\r\n"say ""hi"""');
    expect(toCsv(['x'], [['line1\nline2']])).toBe('x\r\n"line1\nline2"');
  });
});
