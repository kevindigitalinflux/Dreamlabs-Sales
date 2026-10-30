import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const references = ['file-format.md', 'interview-guide.md', 'sequences.md'];
// A fixed ZIP timestamp makes rebuilds stable across machines and timezones.
const options = { level: 9, mtime: new Date(2026, 0, 1, 0, 0, 0) };

/** Builds the public archive from the repository's explicit, reviewed source files. */
export function buildSetupSkillZip(sourceDirectory = join(root, 'setup-skill')) {
  const read = path => new Uint8Array(readFileSync(join(sourceDirectory, path)));
  const skill = { 'dreamlabs-sales-setup/SKILL.md': read('claude-code/dreamlabs-sales-setup/SKILL.md') };
  for (const name of references) skill[`dreamlabs-sales-setup/references/${name}`] = read(`claude-code/dreamlabs-sales-setup/references/${name}`);
  const files = {
    'START HERE.txt': read('START HERE.txt'),
    '1 - Claude Desktop or Claude.ai/dreamlabs-sales-setup.zip': zipSync(skill, options),
  };
  for (const [name, bytes] of Object.entries(skill)) files[`2 - Claude Code (developers)/${name}`] = bytes;
  files['3 - ChatGPT/chatgpt-instructions.md'] = read('chatgpt/chatgpt-instructions.md');
  for (const name of references) files[`3 - ChatGPT/${name}`] = read(`claude-code/dreamlabs-sales-setup/references/${name}`);
  files['4 - Any other chat (paste)/SKILL-single-file.md'] = read('single-file/SKILL-single-file.md');
  return zipSync(files, options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = join(root, 'public/downloads/dreamlabs-sales-setup-skill.zip');
  const bytes = buildSetupSkillZip();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes);
  console.log(`Built public/downloads/dreamlabs-sales-setup-skill.zip (${bytes.length} bytes)`);
}
