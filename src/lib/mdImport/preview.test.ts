import { expect, it } from 'vitest';
import { prepareFiles, pendingProfiles, effectiveSelection, readSetupFiles } from './preview';

it('selects resolvable templates across the whole batch regardless of file order', () => {
  const batch = prepareFiles([
    { filename: 't.md', text: '---\ntype: email-templates\n---\n# Intro\nsubject: Hi\nicp: Offices\n## Body\nHello' },
    { filename: 'p.md', text: '---\ntype: icp-profiles\n---\n# Offices\n## Summary\nWho' },
  ], [], []);
  expect(batch.map((f) => f.selected)).toEqual([[true], [true]]);
  expect(pendingProfiles(batch)).toEqual(['Offices']);
  batch[1].selected[0] = false;
  expect(pendingProfiles(batch)).toEqual([]);
});
it('requires fresh consent when a selected template loses its batch profile', () => {
  const batch = prepareFiles([
    { filename: 't.md', text: '---\ntype: email-templates\nicp: Offices\n---\n# Intro\nsubject: Hi\n## Body\nHello' },
    { filename: 'p.md', text: '---\ntype: icp-profiles\n---\n# Offices\n## Summary\nWho' },
  ], [], []);
  expect(effectiveSelection(batch.slice(0, 1), [])[0].selected).toEqual([false]);
  batch[0].withoutIcp = [true];
  expect(effectiveSelection(batch.slice(0, 1), [])[0].selected).toEqual([true]);
});
it('rejects oversized files before reading and reports file-read failures', async () => {
  let reads = 0;
  const log = console.error; console.error = () => {};
  try {
    const files = await readSetupFiles([
      { name: 'huge.md', size: 204801, text: async () => { reads++; return 'x'; } },
      { name: 'broken.md', size: 1, text: async () => { reads++; throw new Error('read failed'); } },
    ], [], [], '');
    expect(reads).toBe(1);
    expect(files.map((f) => f.parsed.errors[0].message)).toEqual(['File exceeds 200 KB.', 'Could not read this file. Choose a plain UTF-8 .md file.']);
  } finally { console.error = log; }
});
it('leaves unresolved template rows unticked and appends nonempty context by default', () => {
  const batch = prepareFiles([
    { filename: 't.md', text: '---\ntype: email-templates\nicp: Missing\n---\n# Intro\nsubject: Hi\n## Body\nHello' },
    { filename: 'c.md', text: '---\ntype: company-context\n---\nNew' },
  ], [], [], 'Existing');
  expect(batch[0].selected).toEqual([false]); expect(batch[1].append).toBe(true);
  expect(batch[0].replace).toBe(false);
});
