import { describe, expect, it } from 'vitest';
import { backTarget } from './backTarget';

describe('backTarget', () => {
  it('gives sub-pages a way back with a sensible fallback', () => {
    expect(backTarget('/pipeline/leads/abc-123')).toEqual({ fallback: '/pipeline', label: 'Back to pipeline' });
    expect(backTarget('/scraper/jobs/9')).toEqual({ fallback: '/scraper', label: 'Back to scraper' });
    expect(backTarget('/settings/email')?.fallback).toBe('/settings');
    expect(backTarget('/pipeline/deep-find/xyz')?.fallback).toBe('/jobs');
    expect(backTarget('/outreach/autopilot/new')?.fallback).toBe('/outreach/autopilot');
  });
  it('leaves top-level pages without a back arrow', () => {
    for (const path of ['/', '/pipeline/list', '/pipeline/kanban', '/jobs', '/settings', '/emails', '/scraper', '/outreach/autopilot', '/admin']) {
      expect(backTarget(path)).toBeNull();
    }
  });
  it('does not match lookalike paths', () => {
    expect(backTarget('/pipeline/leads')).toBeNull();
    expect(backTarget('/pipeline/leads/a/b')).toBeNull();
    expect(backTarget('/settings/emailx')).toBeNull();
  });
});
