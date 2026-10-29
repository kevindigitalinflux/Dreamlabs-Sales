import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ org: { id: 'org', role: 'member' }, session: { user: { id: 'user' } } }));
vi.mock('../../hooks/useOrg', () => ({ useOrg: () => ({ currentOrg: auth.org }) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ session: auth.session }) }));
vi.mock('../supabase', () => ({ supabase: {} }));
import { ImportSetupButton } from '../../components/mdImport/ImportSetupButton';
import { CopyTemplatesDialog } from '../../components/emails/CopyTemplatesDialog';
import { ImportWizard } from '../../components/mdImport/ImportWizard';

it('hides import controls from nonadmins and shows both admin labels', () => {
  const render = (label?: string) => renderToStaticMarkup(createElement(ImportSetupButton, { label, onApplied: () => {} }));
  expect(render()).toBe('');
  auth.org.role = 'admin';
  expect(render()).toContain('Import setup files');
  expect(render('Import templates')).toContain('Import templates');
  auth.org.role = 'member';
});
it('requires source and target profiles before copying a set', () => {
  const html = renderToStaticMarkup(createElement(CopyTemplatesDialog, { templates: [], icps: [{ id: 'p', name: 'Offices' }], orgId: 'org', userId: 'user', onCopy: async () => null, onClose: () => {} }));
  expect(html).toContain('Source ICP'); expect(html).toContain('Target ICP');
  expect(html).toMatch(/disabled=""[^>]*>Copy templates/);
});
it('blocks the wizard itself for a nonadmin, including both new file types', () => {
  const html = renderToStaticMarkup(createElement(ImportWizard, { orgId: 'org', userId: 'user', isAdmin: false, onClose() {}, onApplied() {} }));
  expect(html).toContain('Only an org admin'); expect(html).not.toContain('Choose files');
});
