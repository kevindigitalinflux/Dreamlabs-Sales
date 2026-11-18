import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({role:'admin',read:vi.fn()}));
vi.mock('../hooks/useOrg',()=>({useOrg:()=>({currentOrg:{id:'org',role:h.role}})}));
vi.mock('../hooks/useApiKeyHealth',()=>({useApiKeyHealth:org=>{h.read(org);return {rows:[{},{}]};}}));
import {ApiKeyHealthBadge} from '../components/settings/ApiKeyHealthBadge';
it('counts flagged keys only for admins and does not scope a member subscription',()=>{
 h.role='admin';expect(renderToStaticMarkup(createElement(ApiKeyHealthBadge))).toContain('2 API keys need attention');expect(h.read).toHaveBeenLastCalledWith('org');
 h.role='contractor';expect(renderToStaticMarkup(createElement(ApiKeyHealthBadge))).toBe('');expect(h.read).toHaveBeenLastCalledWith(null);
});
