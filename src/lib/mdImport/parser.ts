import type { Issue, ParsedFile } from './types';
import { profile, records, template } from './sections';

/** Parses the setup format without I/O. */
export function parseSetupFile(text: string, filename: string, customKeys: string[] = []): ParsedFile {
  const errors: Issue[] = [], warnings: Issue[] = [];
  const invalid: ParsedFile = { type: null, data: null, errors, warnings };
  if (!/\.md$/i.test(filename)) errors.push({ line: 1, message: 'Choose a .md file.' });
  if (new TextEncoder().encode(text).length > 200 * 1024) errors.push({ line: 1, message: 'File exceeds 200 KB.' });
  text = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) { errors.push({ line: 1, message: 'File is empty.' }); return invalid; }
  const lines = text.split('\n').map((text, i) => ({ text, line: i + 1 }));
  for (const l of lines) {
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/.test(l.text)) errors.push({ line: l.line, message: 'File contains binary or invalid UTF-8 text.' });
    if (/<\/?[A-Za-z][^>]*>|<!--/.test(l.text)) errors.push({ line: l.line, message: 'HTML is not allowed.' });
    if (/!\[.*\]\(/.test(l.text)) errors.push({ line: l.line, message: 'Markdown images are not allowed.' });
    if (/^\s*\|.*\|/.test(l.text) || /^\s*:?-{3,}:?\s*\|/.test(l.text)) errors.push({ line: l.line, message: 'Markdown tables are not allowed.' });
  }
  const end = lines.findIndex((l, i) => i > 0 && l.text === '---');
  if (lines[0].text !== '---' || end < 0) { errors.push({ line: 1, message: 'Missing front matter between --- lines.' }); return invalid; }
  const meta: Record<string, string> = {};
  for (const l of lines.slice(1, end)) {
    if (!l.text.trim()) continue;
    const m = /^(type|icp|category):\s*(.*)$/.exec(l.text);
    if (!m) { errors.push({ line: l.line, message: 'Unknown front matter field.' }); continue; }
    if (Object.hasOwn(meta, m[1])) errors.push({ line: l.line, message: `Duplicate ${m[1]}.` });
    meta[m[1]] = m[2].trim();
  }
  const type = meta.type;
  if (!['company-context', 'icp-profiles', 'email-templates'].includes(type)) { errors.push({ line: 2, message: 'Unknown or missing type.' }); return invalid; }
  if (type !== 'email-templates' && (meta.icp !== undefined || meta.category !== undefined)) errors.push({ line: 2, message: 'icp and category defaults are only for email templates.' });
  const bodyLines = lines.slice(end + 1);
  if (type === 'company-context') {
    const data = bodyLines.map((l) => l.text).join('\n').trim();
    if (!data) errors.push({ line: end + 2, message: 'Company context is empty.' });
    if (data.length > 8000) errors.push({ line: end + 2, message: 'Company context exceeds 8,000 characters.' });
    return { type, data, errors, warnings };
  }
  const blocks = records(bodyLines, errors);
  const limit = type === 'icp-profiles' ? 50 : 100;
  if (blocks.length > limit) errors.push({ line: blocks[limit][0].line, message: `Maximum ${limit} items per file.` });
  const seen = new Set<string>();
  for (const b of blocks) {
    const name = b[0].text.slice(2).trim();
    if (!name || name.length > 80) errors.push({ line: b[0].line, message: 'Name must have 1 to 80 characters.' });
    if (type === 'icp-profiles' && seen.has(name.toLowerCase())) errors.push({ line: b[0].line, message: 'Duplicate profile name.' });
    seen.add(name.toLowerCase());
  }
  return type === 'icp-profiles'
    ? { type, data: blocks.map((b) => profile(b, errors)), errors, warnings }
    : { type: 'email-templates', data: blocks.map((b) => template(b, meta, errors, warnings, customKeys)), errors, warnings };
}
