import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import startHere from '../../setup-skill/START HERE.txt?raw';
import { expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ role: 'member' }));
vi.mock('../hooks/useOrg', () => ({ useOrg: () => ({ currentOrg: { id: 'org', name: 'Example', role: auth.role } }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ profile: null, session: { user: { id: 'user' } }, refreshProfile: async () => {} }) }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
// These unrelated cards read remote state. Keep the Settings setup card and import control real.
vi.mock('../components/settings/CompanyProfileCard', () => ({ CompanyProfileCard: () => null }));
vi.mock('../components/settings/IdealCustomerProfilesCard', () => ({ IdealCustomerProfilesCard: () => null }));
vi.mock('../components/settings/CustomPlaceholdersCard', () => ({ CustomPlaceholdersCard: () => null }));
vi.mock('../components/settings/UsageLimitsCard', () => ({ UsageLimitsCard: () => null }));
vi.mock('../components/settings/DesktopNotificationsCard', () => ({ DesktopNotificationsCard: () => null }));
vi.mock('../components/settings/MailboxStatus', () => ({ MailboxStatus: () => null }));
import { Settings } from './Settings';

function setupSteps(html: string) {
  const list = html.slice(html.indexOf('<ol aria-label="Setup steps"'));
  const items: string[] = [];
  let depth = 0, start = 0;
  for (const match of list.matchAll(/<(\/?)(ol|li)\b[^>]*>/g)) {
    if (match[2] === 'ol') depth += match[1] ? -1 : 1;
    else if (depth === 1 && !match[1]) start = match.index + match[0].length;
    else if (depth === 1 && match[1]) items.push(list.slice(start, match.index));
    if (depth === 0) break;
  }
  return items;
}

const titles = ['Download', 'Open the folder', 'Add the skill', 'Answer the questions', 'Save your files', 'Import them', 'Switch sequences on'];
const plainText = (html: string) => html.replace(/<\/(?:p|li|div|ol|summary|aside|h[1-6])>/g, ' ').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

it.each(['member', 'admin'])('offers a real setup zip download for an organisation %s', role => {
  auth.role = role;
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Settings)));
  const link = html.match(/<a\b[^>]*href="\/downloads\/dreamlabs-sales-setup-skill.zip"[^>]*>.*?<\/a>/s)?.[0];
  expect(link).toBeDefined();
  expect(link).toMatch(/\bdownload(?:="[^"]*")?/);
  expect(link).toContain('Download setup skill');
  expect(link).toContain('focus-visible:');
  for (const token of ['bg-violet', 'text-on-accent', 'hover:bg-violet/85', 'min-h-11', 'motion-reduce:transition-none']) expect(link).toContain(token);
  const imports = html.match(/<button\b[^>]*>Import setup files<\/button>/g) ?? [];
  expect(imports).toHaveLength(role === 'admin' ? 1 : 0);
  if (role === 'admin') {
    expect(imports[0]).toContain('border-line bg-surface text-offwhite');
    expect(html.indexOf('Download setup skill')).toBeLessThan(html.indexOf('>Import setup files'));
  }
  const steps = setupSteps(html);
  expect(steps).toHaveLength(7);
  titles.forEach((title, index) => expect(steps[index]).toContain(`<strong>${title}</strong>`));
  expect(steps[5]).toContain('Admins only');
  expect(steps[5]).toContain('Not an admin? Send the files to your admin.');
});

it('opens the recommended tool first and keeps three keyboard-accessible alternatives collapsed', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Settings)));
  const options = [...html.matchAll(/<details\b([^>]*)>(.*?)<\/details>/gs)];
  expect(options).toHaveLength(4);
  const names = ['Claude Desktop or Claude.ai', 'Claude Code (developers)', 'ChatGPT', 'Any other chat (paste)'];
  options.forEach((option, index) => {
    expect(option[1].includes('open=""')).toBe(index === 0);
    const summary = option[2].match(/<summary\b[^>]*>(.*?)<\/summary>/s)?.[0];
    expect(summary).toContain(`<strong>${names[index]}</strong>`);
    expect(summary).toContain(`folder ${index + 1}`);
    expect(summary).toContain('focus-visible:');
    expect(summary).toContain('min-h-11');
    expect(option[2]).toContain('<ol');
    expect((option[2].match(/<li\b/g) ?? []).length).toBeLessThanOrEqual(4);
    if (index === 0) expect(summary).toContain('Recommended');
  });
  for (const label of ['Settings', 'Capabilities', 'Customize', 'Skills', 'Create skill', 'Upload a skill']) expect(html).toContain(`<strong>${label}</strong>`);
  expect(html).toMatch(/<code[^>]*>dreamlabs-sales-setup.zip<\/code>/);
});

it('keeps every instruction in the portable text, including labelled choices and separate troubleshooting', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Settings)));
  const steps = setupSteps(html);
  expect(steps).toHaveLength(7);
  const normalized = plainText(html).toLowerCase();
  for (const line of startHere.trim().split(/\r?\n/).filter(Boolean)) {
    expect(normalized).toContain(line.replace(/^\s*\d+\. /, '').replace(/\s+/g, ' ').trim().toLowerCase());
  }
  expect(html).toMatch(/<aside\b[^>]*aria-label="Something went wrong\?"/);
  expect(html).toContain('Ctrl+F5');
  expect(html).toContain('Ask your admin if the import button is missing.');
});
