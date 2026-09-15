import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';

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

describe('parseCsv', () => {
  it('parses a simple CSV with a header row', () => {
    expect(parseCsv('Name,City\nAcme Ltd,London\nBright Sparks,Bristol')).toEqual([
      ['Name', 'City'],
      ['Acme Ltd', 'London'],
      ['Bright Sparks', 'Bristol'],
    ]);
  });

  it('handles quoted cells containing commas and embedded newlines', () => {
    const csv = 'Name,Notes\n"Acme, Ltd","Called twice.\nStill interested."';
    expect(parseCsv(csv)).toEqual([
      ['Name', 'Notes'],
      ['Acme, Ltd', 'Called twice.\nStill interested.'],
    ]);
  });

  it('handles escaped double quotes inside a quoted cell', () => {
    expect(parseCsv('Name\n"Bob ""The Builder"" Smith"')).toEqual([
      ['Name'],
      ['Bob "The Builder" Smith'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('A,B\r\n1,2\r\n3,4')).toEqual([['A', 'B'], ['1', '2'], ['3', '4']]);
  });

  it('is the exact inverse of toCsv for round-trippable input', () => {
    const headers = ['Name', 'Notes'];
    const rows = [['Acme, Ltd', 'Line one\nLine two'], ['Plain Co', 'No special chars']];
    expect(parseCsv(toCsv(headers, rows))).toEqual([headers, ...rows]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
