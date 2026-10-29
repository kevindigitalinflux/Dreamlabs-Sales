import { expect, it, vi } from 'vitest';
import { buildTemplateVars, AI_PAIN_POINT_MARKER } from './templateVars';
import { buildTemplateVars as serverVars, AI_PAIN_POINT_MARKER as serverMarker } from '../../supabase/functions/_shared/templateVars';
import { validatePainPoint } from '../../supabase/functions/_shared/painPointPick';
import type { Lead } from '../types';
const lead = { id: 'fixture', business_name: 'Fixture', owner_name: null, package_tier: null, deal_value: null } as Lead;
it.each([buildTemplateVars, serverVars])('ignores AI picks, keeps manual and unmarked legacy notes', build => {
  vi.stubGlobal('Deno', { env: { get: () => undefined } });
  try {
    const ai = 'Pain point pick v1\nMain pain point:\nAI choice';
    expect(build(lead, 'Rep', [ai], 'ICP first').pain_point).toBe('ICP first');
    expect(build(lead, 'Rep', [ai, 'Main pain point:\nManual'], 'ICP first').pain_point).toBe('Manual');
    expect(build(lead, 'Rep', ['Legacy AI notes\nMain pain point:\nLegacy'], 'ICP first').pain_point).toBe('Legacy');
  } finally { vi.unstubAllGlobals(); }
});
it('keeps marker copies aligned', () => expect(AI_PAIN_POINT_MARKER).toBe(serverMarker));
it.each([['Cover', 'proposed', 'icp_list'], ['New angle', 'icp_list', 'proposed']] as const)('keeps chosen text despite a wrong source label', (pain_point, source, expected) => {
  expect(validatePainPoint({ pain_point, source, reason: 'Saved facts.' }, ['Cover'])).toEqual({ pain_point, source: expected, reason: 'Saved facts.' });
});
