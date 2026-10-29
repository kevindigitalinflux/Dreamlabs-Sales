import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseSetupFile } from './parser';
const parse = (type, body, extra = '') => parseSetupFile(`---\ntype: ${type}\n${extra}---\n${body}`, 'fixture.md');
const sequence = '# Follow-up\nicp: Offices\n## Steps\n1. template: Intro | wait_days: 0\n2. template: Reminder | wait_days: 4';
it('parses consecutive steps with waits and optional ICP', () => {
  expect(parse('sequences', sequence)).toMatchObject({ type: 'sequences', errors: [], data: [{ name: 'Follow-up', icp: 'Offices', steps: [{ template: 'Intro', wait_days: 0 }, { template: 'Reminder', wait_days: 4 }] }] });
});
it.each([
  [sequence.replace('2. template', '3. template'), 'consecutive'],
  ...['-1', '61', '2.5', 'soon'].map(value => [sequence.replace('wait_days: 4', `wait_days: ${value}`), 'wait_days']),
  [sequence + '\n# FOLLOW-UP\n## Steps\n1. template: Intro | wait_days: 0', 'Duplicate'],
  [sequence.replace('icp: Offices', 'unknown: value'), 'Unknown'],
  [sequence.replace('## Steps', '## Other'), 'Steps'],
  [sequence + '\n## Steps', 'Duplicate'],
  ['# Long\n## Steps\n' + Array.from({ length: 11 }, (_, i) => `${i + 1}. template: Intro | wait_days: 0`).join('\n'), '10'],
  ['# ' + 's'.repeat(81) + '\n## Steps\n1. template: Intro | wait_days: 0', '80'],
  [Array.from({ length: 101 }, (_, i) => `# Sequence ${i}\n## Steps\n1. template: Intro | wait_days: 0`).join('\n'), '100'],
])('rejects invalid sequences: %s', (body, error) => expect(parse('sequences', body).errors.some(e => e.message.includes(error))).toBe(true));
it('requires an explicit type for sequences and packages', () => {
  expect(parseSetupFile(sequence, 's.md').errors.length).toBeGreaterThan(0);
  expect(parseSetupFile('# Offer', 'p.md').errors.length).toBeGreaterThan(0);
});
it('preserves prices and punctuation in arbitrary organisation labels and previews unstored details', () => {
  expect(parse('company-packages', '#  Growth   $250 / month\nTimeline: 2 weeks\n- Details')).toMatchObject({ type: 'company-packages', errors: [], data: [{ name: 'Growth $250 / month', details: 'Timeline: 2 weeks\n- Details' }] });
});
it.each([
  ['# Offer\nDetails\n# OFFER', 'Duplicate'], ['# ' + 'x'.repeat(81), '80'],
  [Array.from({ length: 21 }, (_, i) => `# Offer ${i}`).join('\n'), '20'],
])('rejects invalid package labels: %s', (body, error) => expect(parse('company-packages', body).errors.some(e => e.message.includes(error))).toBe(true));
it('rejects unknown front matter for both new types and keeps common file limits', () => {
  for (const type of ['sequences', 'company-packages']) {
    expect(parse(type, '# Offer', 'unknown: value\n').errors.some(e => e.message.includes('Unknown'))).toBe(true);
    expect(parse(type, 'x'.repeat(204801)).errors.some(e => e.message.includes('200 KB'))).toBe(true);
  }
});
it('parses the shipped 32-sequence fixture with 80 steps, four per profile and the prescribed counts', () => {
  const result = parseSetupFile(readFileSync('docs/setup-pack/sequences.md', 'utf8'), 'sequences.md');
  expect(result.errors).toEqual([]); expect(result.data).toHaveLength(32);
  expect(result.data.reduce((sum, seq) => sum + seq.steps.length, 0)).toBe(80);
  const profiles = [...new Set(result.data.map(seq => seq.icp))]; expect(profiles).toHaveLength(8);
  for (const name of profiles) expect(result.data.filter(seq => seq.icp === name).map(seq => seq.steps.length)).toEqual([3, 2, 3, 2]);
});
it('parses the seven-label example package file', () => {
  const parsed = parseSetupFile(readFileSync('docs/setup-pack/company-packages-import.md', 'utf8'), 'company-packages-import.md');
  expect(parsed.errors).toEqual([]); expect(parsed.data).toHaveLength(7);
});
