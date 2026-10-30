import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const archive = new URL('public/downloads/dreamlabs-sales-setup-skill.zip', root);
const references = ['file-format.md', 'interview-guide.md', 'sequences.md'];
const codePrefix = '2 - Claude Code (developers)/dreamlabs-sales-setup/';
const uploadPath = '1 - Claude Desktop or Claude.ai/dreamlabs-sales-setup.zip';

function entries() {
  expect(existsSync(archive), 'The downloadable setup zip must be committed').toBe(true);
  return unzipSync(readFileSync(archive));
}

it('ships all four tool choices and an upload-ready Claude skill folder', () => {
  const files = entries();
  expect(Object.keys(files).sort()).toEqual([
    'START HERE.txt', uploadPath, `${codePrefix}SKILL.md`,
    ...references.map(name => `${codePrefix}references/${name}`),
    '3 - ChatGPT/chatgpt-instructions.md', ...references.map(name => `3 - ChatGPT/${name}`),
    '4 - Any other chat (paste)/SKILL-single-file.md',
  ].sort());
  const claude = unzipSync(files[uploadPath]);
  expect(Object.keys(claude).sort()).toEqual([
    'dreamlabs-sales-setup/SKILL.md', ...references.map(name => `dreamlabs-sales-setup/references/${name}`),
  ].sort());
  for (const [name, bytes] of Object.entries(claude)) expect(bytes).toEqual(files[`2 - Claude Code (developers)/${name}`]);
});

it('ships only relative paths and safe public text, including inside the nested zip', () => {
  const files = entries();
  const nested = unzipSync(files[uploadPath]);
  for (const [name, bytes] of Object.entries({ ...files, ...nested })) {
    expect(name).not.toMatch(/README\.md|^[/\\]|^[a-z]:|\\|(^|\/)\.\.($|\/)/i);
    if (name.endsWith('.zip')) continue;
    const text = strFromU8(bytes);
    expect(text).not.toMatch(/C:\\|C:\/Users|DI Dreamlabs Context Brain|OneDrive|_Tools\/Custom skills/i);
    // Guidance says never to share passwords. Match credentials, not that safety advice.
    expect(text).not.toMatch(/sk-[a-zA-Z0-9_-]{16,}|eyJ[a-zA-Z0-9_-]{16,}\.|SUPABASE_[A-Z_]+\s*[:=]\s*\S+|password\s*[:=]\s*\S+/i);
  }
  expect(readFileSync(archive).length).toBeLessThan(1024 * 1024);
});

it('keeps every shipped file byte-identical to sources and detects a stale committed zip', async () => {
  const files = entries();
  const source = new URL('setup-skill/', root);
  expect(files['START HERE.txt']).toEqual(new Uint8Array(readFileSync(new URL('START HERE.txt', source))));
  expect(files[`${codePrefix}SKILL.md`]).toEqual(new Uint8Array(readFileSync(new URL('claude-code/dreamlabs-sales-setup/SKILL.md', source))));
  for (const name of references) {
    const bytes = new Uint8Array(readFileSync(new URL(`claude-code/dreamlabs-sales-setup/references/${name}`, source)));
    expect(files[`${codePrefix}references/${name}`]).toEqual(bytes);
    expect(files[`3 - ChatGPT/${name}`]).toEqual(bytes);
  }
  expect(files['3 - ChatGPT/chatgpt-instructions.md']).toEqual(new Uint8Array(readFileSync(new URL('chatgpt/chatgpt-instructions.md', source))));
  expect(files['4 - Any other chat (paste)/SKILL-single-file.md']).toEqual(new Uint8Array(readFileSync(new URL('single-file/SKILL-single-file.md', source))));
  const { buildSetupSkillZip } = await import('../../scripts/build-setup-skill-zip.mjs');
  const rebuilt = unzipSync(buildSetupSkillZip(fileURLToPath(source)));
  expect(Object.keys(rebuilt).sort()).toEqual(Object.keys(files).sort());
  for (const name of Object.keys(files)) expect(rebuilt[name]).toEqual(files[name]);
});

it('ships short plain Windows text generated from the shared instruction structure', async () => {
  const text = strFromU8(entries()['START HERE.txt']);
  const titles = ['Download', 'Open the folder', 'Add the skill', 'Answer the questions', 'Save your files', 'Import them', 'Switch sequences on'];
  titles.forEach((title, index) => expect(text).toContain(`${index + 1}. ${title}\r\n`));
  expect(new TextEncoder().encode(text).length).toBeLessThan(4096);
  expect(text).not.toMatch(/\*\*|`|^\s*#{1,6}\s|<\/?[a-z][^>]*>|\[[^\]]+\]\(/im);
  expect(text).toContain('\r\n\r\nCLAUDE DESKTOP OR CLAUDE.AI');
  const source = JSON.parse(readFileSync(new URL('setup-skill/instructions.json', root), 'utf8'));
  const { renderStartHere } = await import('../../scripts/build-setup-skill-zip.mjs');
  expect(text).toBe(renderStartHere(source));
  expect(readFileSync(new URL('setup-skill/START HERE.txt', root), 'utf8')).toBe(text);
});

// Explicit post-build check avoids treating a previous build as the current one.
it.skipIf(process.env.CHECK_BUILT_ASSETS !== '1')('copies the real download into built static assets', () => {
  const built = new URL('dist/downloads/dreamlabs-sales-setup-skill.zip', root);
  expect(existsSync(built)).toBe(true);
  expect(readFileSync(built)).toEqual(readFileSync(archive));
  expect(readdirSync(new URL('dist/downloads/', root))).toContain('dreamlabs-sales-setup-skill.zip');
});
