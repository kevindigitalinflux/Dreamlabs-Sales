import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const references = ['file-format.md', 'interview-guide.md', 'sequences.md'];
// A fixed ZIP timestamp makes rebuilds stable across machines and timezones.
const options = { level: 9, mtime: new Date(2026, 0, 1, 0, 0, 0) };

/** Renders shared instructions as plain text with Windows-friendly line endings. */
export function renderStartHere(instructions) {
  const blocks = [];
  instructions.steps.forEach((step, index) => {
    const lines = [`${index + 1}. ${step.title}`, ...(step.badge ? [step.badge] : []), ...step.paragraphs];
    if (step.note) lines.push(step.note);
    blocks.push(lines.join('\r\n'));
    for (const option of step.options ?? []) {
      blocks.push([
        `${option.name.toUpperCase()} (${option.folder})${option.recommended ? ' Recommended' : ''}`,
        ...option.steps.map((text, number) => `${number + 1}. ${text}`),
      ].join('\r\n'));
    }
  });
  blocks.push([instructions.troubleshooting.title, ...instructions.troubleshooting.tips].join('\r\n'));
  return `${blocks.join('\r\n\r\n')}\r\n`;
}

/** Builds the public archive from the repository's explicit, reviewed source files. */
export function buildSetupSkillZip(sourceDirectory = join(root, 'setup-skill')) {
  const read = path => new Uint8Array(readFileSync(join(sourceDirectory, path)));
  const skill = { 'dreamlabs-sales-setup/SKILL.md': read('claude-code/dreamlabs-sales-setup/SKILL.md') };
  for (const name of references) skill[`dreamlabs-sales-setup/references/${name}`] = read(`claude-code/dreamlabs-sales-setup/references/${name}`);
  const files = {
    'START HERE.txt': strToU8(renderStartHere(JSON.parse(readFileSync(join(sourceDirectory, 'instructions.json'), 'utf8')))),
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
  writeFileSync(join(root, 'setup-skill/START HERE.txt'), renderStartHere(JSON.parse(readFileSync(join(root, 'setup-skill/instructions.json'), 'utf8'))));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes);
  console.log(`Built public/downloads/dreamlabs-sales-setup-skill.zip (${bytes.length} bytes)`);
}
