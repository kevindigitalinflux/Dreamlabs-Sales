import type { ImportedPackage, ImportedSequence, Issue } from './types';
import type { SourceLine } from './sections';

/** Strict sequence metadata and numbered steps; a complete sequence is one existing JSON row. */
export function sequence(block: SourceLine[], errors: Issue[]): ImportedSequence {
  const result: ImportedSequence = { name: block[0].text.slice(2).trim(), icp: null, steps: [] };
  let steps = false;
  for (const line of block.slice(1)) {
    if (!line.text.trim()) continue;
    if (line.text === '## Steps') {
      if (steps) errors.push({ line: line.line, message: 'Duplicate Steps section.' });
      steps = true; continue;
    }
    if (!steps && line.text.startsWith('icp:')) {
      if (result.icp) errors.push({ line: line.line, message: 'Duplicate icp.' });
      result.icp = line.text.slice(4).trim() || null; continue;
    }
    const match = /^(\d+)\. template: (.+?) \| wait_days: (.+)$/.exec(line.text);
    if (!steps || !match) { errors.push({ line: line.line, message: 'Unknown key or heading. Use icp: then ## Steps and N. template: name | wait_days: integer.' }); continue; }
    if (Number(match[1]) !== result.steps.length + 1) errors.push({ line: line.line, message: 'Steps must be consecutive from 1.' });
    const wait = Number(match[3]);
    if (!/^\d+$/.test(match[3]) || !Number.isInteger(wait) || wait > 60) errors.push({ line: line.line, message: 'wait_days must be an integer from 0 to 60.' });
    result.steps.push({ template: match[2].trim(), wait_days: wait });
  }
  if (!steps || !result.steps.length) errors.push({ line: block[0].line, message: 'One nonempty Steps section is required.' });
  if (result.steps.length > 10) errors.push({ line: block[0].line, message: 'Maximum 10 steps per sequence.' });
  return result;
}

/** Package details are preview-only text; labels preserve the organisation's own prices and wording. */
export function companyPackage(block: SourceLine[], errors: Issue[]): ImportedPackage {
  for (const line of block.slice(1)) if (/^#+\s/.test(line.text)) errors.push({ line: line.line, message: 'Unknown package heading; use one # label per package.' });
  return { name: block[0].text.slice(2).trim().replace(/\s+/g, ' '), details: block.slice(1).map(line => line.text).join('\n').trim() };
}
