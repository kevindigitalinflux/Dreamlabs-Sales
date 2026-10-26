import type { ImportFile, NamedProfile } from './types';
import { parseSetupFile } from './parser';
import { resolveProfile } from './matching';
/** Returns names of valid, selected profiles that can resolve templates in this batch. */
export function pendingProfiles(files: ImportFile[]): string[] {
  return files.flatMap((f) => f.parsed.type === 'icp-profiles' && !f.parsed.errors.length ? f.parsed.data.filter((_, i) => f.selected[i]).map((p) => p.name) : []);
}
/** Parses a batch before choosing defaults, so file order cannot affect ICP resolution. */
export function prepareFiles(sources: { filename: string; text: string }[], profiles: NamedProfile[], customKeys: string[], context = ''): ImportFile[] {
  const files = sources.map(({ filename, text }, i): ImportFile => {
    const parsed = parseSetupFile(text, filename, customKeys);
    const count = parsed.type === 'company-context' ? 1 : parsed.data?.length ?? 0;
    return { id: `file-${i}`, filename, parsed, selected: Array(count).fill(true), replace: false, append: !!context, withoutIcp: Array(count).fill(false) };
  });
  const pending = pendingProfiles(files);
  return files.map((f) => f.parsed.type === 'email-templates' ? { ...f, selected: f.parsed.data.map((t) => resolveProfile(t.icp, profiles, pending) !== 'unresolved') } : f);
}

/** Drops unresolved templates unless the user explicitly chose to leave their ICP empty. */
export function effectiveSelection(files: ImportFile[], profiles: NamedProfile[]): ImportFile[] {
  const pending = pendingProfiles(files);
  return files.map((f) => f.parsed.type === 'email-templates' ? { ...f, selected: f.parsed.data.map((t, i) => !!f.selected[i] && (resolveProfile(t.icp, profiles, pending) !== 'unresolved' || !!f.withoutIcp?.[i])) } : f);
}

/** Reads browser files locally, rejecting large files before allocating their text. */
export async function readSetupFiles(files: Pick<File, 'name' | 'size' | 'text'>[], profiles: NamedProfile[], customKeys: string[], context: string): Promise<ImportFile[]> {
  const failures = new Map<number, string>();
  const sources = await Promise.all(files.map(async (f, i) => {
    let text = '';
    if (f.size > 200 * 1024) failures.set(i, 'File exceeds 200 KB.');
    else {
      try { text = await f.text(); }
      catch (error) { console.error('Could not read setup file', { filename: f.name, error }); failures.set(i, 'Could not read this file. Choose a plain UTF-8 .md file.'); }
    }
    return { filename: f.name, text };
  }));
  return prepareFiles(sources, profiles, customKeys, context).map((f, i) => failures.has(i) ? { ...f, parsed: { type: null, data: null, warnings: [], errors: [{ line: 1, message: failures.get(i)! }] } } : f);
}
