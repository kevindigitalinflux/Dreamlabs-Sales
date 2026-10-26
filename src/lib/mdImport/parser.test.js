import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSetupFile } from './parser';

const file = (type, body, defaults = '') => `---\ntype: ${type}\n${defaults}---\n${body}`;
const icp = '# Property managers\n## Summary\nWho they are.\n## Pain points\n- Late rent\n- Repairs';
const email = '# Intro\nsubject: Hello {{first_name}}\n\n## Body\nHi,\n\nKeep this spacing.\n{{unsubscribe_url}}';

describe('setup parser', () => {
  it('parses all three actual format-document examples', () => {
    const doc = readFileSync('docs/MD-IMPORT-FORMAT.md', 'utf8');
    const blocks = [...doc.matchAll(/```\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks).toHaveLength(3);
    const parsed = blocks.map((text) => parseSetupFile(text, 'example.md'));
    expect(parsed.map((p) => p.errors)).toEqual([[], [], []]);
    expect(parsed[0].data).toBe('Mr Brush & Co is a commercial cleaning company in the UK. We clean offices, schools and ...');
    expect(parsed[1].data).toEqual([{ name: 'Property managers', summary: 'Who they are in one or two sentences.', pain_points: 'First item is the one used for the {{pain_point}} placeholder\nSecond item', goals: 'What they want', objections: 'What they push back on, and how to answer it', messaging_notes: 'Tone, words to use or avoid, angles that land.', extra_context: 'Anything else worth knowing.' }]);
    expect(parsed[2].data).toEqual([{ name: 'Intro email', subject: 'Quick question about {{business_name}}', body: 'Hi {{first_name}},\n\nBody text here. Blank lines separate paragraphs.\n\nKind regards,\n{{contractor_name}}', icp: 'Property managers', category: 'Cold outreach', links: [] }]);
  });
  it('normalizes BOM and CRLF without losing body paragraphs', () => {
    const p = parseSetupFile('\ufeff' + file('email-templates', email).replaceAll('\n', '\r\n'), 'A.MD');
    expect(p.errors).toEqual([]);
    expect(p.data[0].body).toBe('Hi,\n\nKeep this spacing.\n{{unsubscribe_url}}');
  });
  it('reads defaults, overrides and https links separately from body', () => {
    const p = parseSetupFile(file('email-templates', '# Intro\nsubject: Hello\nicp: Schools\ncategory: Follow-up\n\n## Body\nText\n\nlinks:\n- [Visit](https://example.com/a)', 'icp: Offices\ncategory: Intro\n'), 't.md');
    expect(p.errors).toEqual([]);
    expect(p.data[0]).toEqual({ name: 'Intro', subject: 'Hello', icp: 'Schools', category: 'Follow-up', body: 'Text', links: [{ label: 'Visit', url: 'https://example.com/a' }] });
  });
  it.each([
    ['', 'empty'], ['abc', 'front matter'], [file('other', 'x'), 'type'],
    [file('icp-profiles', '# A\n## Goals\n- B'), 'Summary'],
    [file('icp-profiles', icp + '\n# PROPERTY MANAGERS\n## Summary\nB'), 'Duplicate'],
    [file('icp-profiles', '# A\n## Pain point\nx'), 'unknown section'],
    [file('icp-profiles', '# A\n## Summary\nx\n## Goals\nnot a list'), 'list'],
    [file('email-templates', '# A\n## Body\nx'), 'subject'],
    [file('email-templates', '# A\nsubject: x'), 'Body'],
    [file('email-templates', email + '\nlinks:\n- [Bad](http://example.com)'), 'https'],
    [file('company-context', 'x\0y'), 'binary'],
    [file('company-context', 'x'.repeat(8001)), '8,000'],
    [file('icp-profiles', '# ' + 'x'.repeat(81) + '\n## Summary\nx'), '80'],
    [file('icp-profiles', '# A\n## Summary\n' + 'x'.repeat(3001)), '3,000'],
    [file('icp-profiles', Array.from({ length: 51 }, (_, i) => `# A${i}\n## Summary\nx`).join('\n')), '50'],
    [file('email-templates', Array.from({ length: 101 }, (_, i) => `# A${i}\nsubject: x\n## Body\nx`).join('\n')), '100'],
    [file('company-context', 'é'.repeat(103000)), '200 KB'],
    [file('company-context', '<script>alert(1)</script>'), 'HTML'],
    [file('company-context', '![Image](https://example.com/x)'), 'images'],
    [file('company-context', '| A | B |\n| --- | --- |'), 'tables'],
  ])('rejects invalid input with line and reason (%s)', (text, reason) => {
    const p = parseSetupFile(text, 'x.md');
    expect(p.errors.some((e) => e.message.includes(reason))).toBe(true);
    expect(p.errors.every((e) => Number.isInteger(e.line) && e.line > 0)).toBe(true);
  });
  it('rejects wrong extension and duplicate metadata', () => {
    expect(parseSetupFile(file('company-context', 'x'), 'x.txt').errors.length).toBeGreaterThan(0);
    expect(parseSetupFile(file('company-context', 'x', 'type: company-context\n'), 'x.md').errors.length).toBeGreaterThan(0);
  });
  it('warns for unknown and risky placeholders and missing unsubscribe, accepts custom keys', () => {
    const p = parseSetupFile(file('email-templates', '# A\nsubject: {{custom}} {{alien}}\n## Body\n{{cal_link}}'), 'x.md', ['custom']);
    expect(p.errors).toEqual([]);
    expect(p.warnings.map((w) => w.message).join(' ')).toMatch(/alien/);
    expect(p.warnings.map((w) => w.message).join(' ')).toMatch(/unsubscribe_url/);
    expect(p.warnings.map((w) => w.message).join(' ')).toMatch(/cal_link/);
    expect(p.warnings.map((w) => w.message).join(' ')).not.toMatch(/unknown placeholder 'custom'/);
  });
});
