import type { IcpInput } from '../../hooks/useIcps';
import type { ImportedTemplate, Issue } from './types';
import { TEMPLATE_VARIABLES } from '../templateVars';

export interface SourceLine { text: string; line: number }
const headings: Record<string, keyof Omit<IcpInput, 'name'>> = {
  Summary: 'summary', 'Pain points': 'pain_points', Goals: 'goals', Objections: 'objections',
  'Messaging notes': 'messaging_notes', 'Extra context': 'extra_context',
};

/** Splits records at exact level-one headings, retaining original line numbers. */
export function records(lines: SourceLine[], errors: Issue[]): SourceLine[][] {
  const out: SourceLine[][] = [];
  for (const l of lines) {
    if (l.text.startsWith('# ')) out.push([l]);
    else if (out.length) out[out.length - 1].push(l);
    else if (l.text.trim()) errors.push({ line: l.line, message: 'Start each item with a # name heading.' });
  }
  if (!out.length) errors.push({ line: lines[0]?.line ?? 1, message: 'No items found.' });
  return out;
}

/** Parses the fixed profile sections; list markers become editor-compatible lines. */
export function profile(block: SourceLine[], errors: Issue[]): IcpInput {
  const out: IcpInput = { name: block[0].text.slice(2).trim(), summary: '', pain_points: '', goals: '', objections: '', messaging_notes: '', extra_context: '' };
  let key: keyof Omit<IcpInput, 'name'> | undefined;
  let section: SourceLine[] = [];
  const seen = new Set<string>();
  function flush() {
    if (!key) return;
    const value = section.map((l) => l.text).join('\n').trim();
    if (value.length > 3000) errors.push({ line: section[0]?.line ?? block[0].line, message: 'Section exceeds 3,000 characters.' });
    if (['pain_points', 'goals', 'objections'].includes(key)) {
      for (const l of section) if (l.text.trim() && !l.text.startsWith('- ')) errors.push({ line: l.line, message: 'Use one - list item per line.' });
      out[key] = section.filter((l) => l.text.trim()).map((l) => l.text.slice(2).trim()).join('\n');
    } else out[key] = value;
  }
  for (const l of block.slice(1)) {
    if (/^#+\s/.test(l.text)) {
      flush(); section = [];
      key = headings[l.text.slice(3)];
      if (!l.text.startsWith('## ') || !key) errors.push({ line: l.line, message: `unknown section '${l.text}'. Use: ${Object.keys(headings).join(', ')}.` });
      else if (seen.has(key)) errors.push({ line: l.line, message: 'Duplicate section.' });
      if (key) seen.add(key);
    } else if (key) section.push(l);
    else if (l.text.trim()) errors.push({ line: l.line, message: 'Text must be under a known section.' });
  }
  flush();
  if (!out.summary) errors.push({ line: block[0].line, message: 'Summary is required.' });
  return out;
}

/** Parses template metadata, literal body and optional HTTPS links. */
export function template(block: SourceLine[], defaults: Record<string, string>, errors: Issue[], warnings: Issue[], customKeys: string[]): ImportedTemplate {
  const meta: Record<string, string> = { ...defaults };
  const seen = new Set<string>();
  const body: string[] = [];
  const links: ImportedTemplate['links'] = [];
  let mode: 'meta' | 'body' | 'links' = 'meta';
  let bodyFound = false;
  for (const l of block.slice(1)) {
    if (l.text === '## Body') {
      if (bodyFound) errors.push({ line: l.line, message: 'Duplicate Body section.' });
      bodyFound = true; mode = 'body'; continue;
    }
    if (/^#+\s/.test(l.text)) { errors.push({ line: l.line, message: `unknown section '${l.text}'. Use ## Body.` }); continue; }
    if (mode === 'meta') {
      if (!l.text.trim()) continue;
      const m = /^(subject|icp|category):\s*(.*)$/.exec(l.text);
      if (!m) { errors.push({ line: l.line, message: 'Use subject:, icp: or category: before ## Body.' }); continue; }
      if (seen.has(m[1])) errors.push({ line: l.line, message: `Duplicate ${m[1]}.` });
      seen.add(m[1]); meta[m[1]] = m[2].trim();
    } else if (l.text === 'links:') {
      if (mode === 'links') errors.push({ line: l.line, message: 'Duplicate links section.' });
      mode = 'links';
    } else if (mode === 'body') body.push(l.text);
    else if (l.text.trim()) {
      const m = /^- \[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/.exec(l.text);
      let valid = false;
      if (m) { try { valid = new URL(m[2]).protocol === 'https:'; } catch (error) { /* Invalid URLs are reported below; no I/O occurs. */ void error; } }
      if (!m || !valid) errors.push({ line: l.line, message: 'Use - [Label](https://example.com) for each link; only https is allowed.' });
      else links.push({ label: m[1], url: m[2] });
    }
  }
  const text = body.join('\n').trim();
  if (!meta.subject) errors.push({ line: block[0].line, message: 'subject is required.' });
  if (!bodyFound || !text) errors.push({ line: block[0].line, message: 'Body is required.' });
  if (text.length > 3000 || (meta.subject?.length ?? 0) > 3000) errors.push({ line: block[0].line, message: 'Section exceeds 3,000 characters.' });
  const known = new Set([...TEMPLATE_VARIABLES.map((v) => v.key), ...customKeys]);
  for (const key of new Set([...`${meta.subject ?? ''}\n${text}`.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1]))) {
    if (!known.has(key)) warnings.push({ line: block[0].line, message: `unknown placeholder '${key}'.` });
    if (['cal_link', 'audit_date'].includes(key)) warnings.push({ line: block[0].line, message: `{{${key}}} can be empty when sent. Describe the next step in words.` });
  }
  if (!text.includes('{{unsubscribe_url}}')) warnings.push({ line: block[0].line, message: 'Missing {{unsubscribe_url}} in the body.' });
  return { name: block[0].text.slice(2).trim(), subject: meta.subject ?? '', body: text, icp: meta.icp || null, category: meta.category || null, links };
}
