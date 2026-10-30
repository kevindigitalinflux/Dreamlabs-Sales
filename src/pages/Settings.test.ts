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

it.each(['member', 'admin'])('offers a real setup zip download for an organisation %s', role => {
  auth.role = role;
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Settings)));
  const link = html.match(/<a\b[^>]*href="\/downloads\/dreamlabs-sales-setup-skill.zip"[^>]*>.*?<\/a>/s)?.[0];
  expect(link).toBeDefined();
  expect(link).toMatch(/\bdownload(?:="[^"]*")?/);
  expect(link).toContain('Download setup skill');
  expect(link).toContain('focus-visible:');
  const imports = html.match(/<button\b[^>]*>Import setup files<\/button>/g) ?? [];
  expect(imports).toHaveLength(role === 'admin' ? 1 : 0);
  expect(html).toContain('<ol');
  expect(html.match(/<li\b/g)).toHaveLength(7);
  expect(html).toContain('Only an admin can upload the finished files. If you are not an admin, send the files to your admin.');
});

it('uses the same instructions in Settings and START HERE, with every tool and recovery steps', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Settings)));
  const rendered = [...html.matchAll(/<li\b[^>]*>(.*?)<\/li>/gs)].map(match => match[1]);
  const instructions = startHere.trim().split(/\r?\n\r?\n/);
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  expect(rendered).toEqual(instructions.slice(0, 7).map(text => escape(text.replace(/^\d+\. /, ''))));
  expect(html).toContain(escape(instructions[7]));
  for (const tool of ['Claude', 'ChatGPT', 'Claude Code']) expect(html).toContain(tool);
  expect(html).toContain('Ctrl+F5');
  expect(html).toContain('admin if the import button is missing');
});
