import { describe, expect, it } from 'vitest';
import { sanitizeDreamAgentActions, splitContactPatch } from './dreamAgentActions';
import type { Lead } from '../types';

const VALID_IDS = new Set(['lead-1', 'lead-2']);

describe('sanitizeDreamAgentActions', () => {
  it('keeps a valid update action referencing a known lead id', () => {
    const raw = [{ type: 'update', lead_id: 'lead-1', business_name: 'Acme', patch: { stage: 'contacted', deal_value: 500 }, excerpt: 'Called Acme', rationale: 'They confirmed interest' }];
    const result = sanitizeDreamAgentActions(raw, VALID_IDS);
    expect(result).toEqual([{ type: 'update', lead_id: 'lead-1', business_name: 'Acme', patch: { stage: 'contacted', deal_value: 500 }, excerpt: 'Called Acme', rationale: 'They confirmed interest' }]);
  });

  it('drops an update action referencing a lead id outside the valid set', () => {
    const raw = [{ type: 'update', lead_id: 'lead-999', business_name: 'Acme', patch: {}, excerpt: 'x', rationale: 'y' }];
    expect(sanitizeDreamAgentActions(raw, VALID_IDS)).toEqual([]);
  });

  it('drops invalid patch fields but keeps valid ones on an update action', () => {
    const raw = [{ type: 'update', lead_id: 'lead-1', business_name: 'Acme', patch: { stage: 'not_a_real_stage', deal_value: 500, package_tier: 'nonsense' }, excerpt: 'x', rationale: 'y' }];
    const result = sanitizeDreamAgentActions(raw, VALID_IDS);
    expect(result).toEqual([{ type: 'update', lead_id: 'lead-1', business_name: 'Acme', patch: { deal_value: 500 }, excerpt: 'x', rationale: 'y' }]);
  });

  it('keeps a valid create action', () => {
    const raw = [{ type: 'create', extracted: { business_name: 'Bright Sparks', owner_name: null, phone: '01234', email: null, website: null, city: 'Bristol', vertical: null }, excerpt: 'Followed up with Bright Sparks', rationale: 'New prospect mentioned' }];
    expect(sanitizeDreamAgentActions(raw, VALID_IDS)).toEqual([{ ...raw[0], patch: {} }]);
  });

  it('keeps and whitelists a create action patch (stage + follow-up)', () => {
    const raw = [{
      type: 'create',
      extracted: { business_name: 'The Greenhouse', owner_name: null, phone: null, email: null, website: null, city: null, vertical: null },
      patch: { stage: 'contacted', next_action_date: '2026-10-05', next_action_note: 'Follow up by email', package_tier: 'nonsense', stage_extra: 'x' },
      excerpt: 'Left card', rationale: 'Walk-in visit',
    }];
    const [action] = sanitizeDreamAgentActions(raw, VALID_IDS);
    expect(action).toMatchObject({ type: 'create', patch: { stage: 'contacted', next_action_date: '2026-10-05', next_action_note: 'Follow up by email' } });
    expect((action as unknown as { patch: Record<string, unknown> }).patch).not.toHaveProperty('package_tier');
  });

  it('drops a create action missing a business_name', () => {
    const raw = [{ type: 'create', extracted: { business_name: '', owner_name: null, phone: null, email: null, website: null, city: null, vertical: null }, excerpt: 'x', rationale: 'y' }];
    expect(sanitizeDreamAgentActions(raw, VALID_IDS)).toEqual([]);
  });

  it('keeps a valid ambiguous action, filtering candidate ids to the valid set', () => {
    const raw = [{ type: 'ambiguous', mentioned_text: 'Bright', candidate_lead_ids: ['lead-1', 'lead-2', 'lead-999'], excerpt: 'x' }];
    const result = sanitizeDreamAgentActions(raw, VALID_IDS);
    expect(result).toEqual([{ type: 'ambiguous', mentioned_text: 'Bright', candidate_lead_ids: ['lead-1', 'lead-2'], excerpt: 'x' }]);
  });

  it('drops an ambiguous action left with zero valid candidates', () => {
    const raw = [{ type: 'ambiguous', mentioned_text: 'Bright', candidate_lead_ids: ['lead-999'], excerpt: 'x' }];
    expect(sanitizeDreamAgentActions(raw, VALID_IDS)).toEqual([]);
  });

  it('drops an action with an unrecognized type', () => {
    expect(sanitizeDreamAgentActions([{ type: 'delete', lead_id: 'lead-1' }], VALID_IDS)).toEqual([]);
  });

  it('returns an empty array for a non-array input', () => {
    expect(sanitizeDreamAgentActions({ not: 'an array' }, VALID_IDS)).toEqual([]);
    expect(sanitizeDreamAgentActions(null, VALID_IDS)).toEqual([]);
  });
});

describe('contact details in an update patch', () => {
  it('keeps trimmed contact fields and drops blanks/non-strings', () => {
    const raw = [{ type: 'update', lead_id: 'lead-1', business_name: 'Acme', patch: { owner_name: ' Giuseppe Amoruso ', email: 'admin@x.com', phone: '', website: 42, postcode: 'E2 7AA' }, excerpt: 'x', rationale: 'y' }];
    const [action] = sanitizeDreamAgentActions(raw, VALID_IDS);
    expect(action).toMatchObject({ patch: { owner_name: 'Giuseppe Amoruso', email: 'admin@x.com', postcode: 'E2 7AA' } });
    expect((action as unknown as { patch: Record<string, unknown> }).patch).not.toHaveProperty('phone');
    expect((action as unknown as { patch: Record<string, unknown> }).patch).not.toHaveProperty('website');
  });

  it('keeps address/postcode on a create action\'s extracted details', () => {
    const raw = [{ type: 'create', extracted: { business_name: 'Bright Sparks', owner_name: null, phone: null, email: null, website: null, city: 'Bristol', vertical: null, address: '1 High St', postcode: 'BS1 1AA' }, patch: {}, excerpt: 'x', rationale: 'y' }];
    expect(sanitizeDreamAgentActions(raw, VALID_IDS)[0]).toMatchObject({ extracted: { address: '1 High St', postcode: 'BS1 1AA' } });
  });
});

describe('splitContactPatch', () => {
  const lead = { owner_name: 'Isabella', phone: null, email: 'info@x.com', website: 'https://x.com', address: null, city: 'London', postcode: null, vertical: 'Property' } as unknown as Lead;

  it('fills blanks and keeps a differing email/owner as additional details', () => {
    expect(splitContactPatch(lead, { phone: '0207', email: 'sally@x.com', owner_name: 'Sally Jones', postcode: 'E2 7AA' })).toEqual({
      fill: { phone: '0207', postcode: 'E2 7AA' },
      additions: [
        { field: 'owner_name', value: 'Sally Jones', source: 'note' },
        { field: 'email', value: 'sally@x.com', source: 'note' },
      ],
    });
  });

  it('never overwrites an existing address/city/vertical and ignores identical values', () => {
    expect(splitContactPatch(lead, { city: 'Bristol', vertical: 'Retail', email: 'INFO@x.com', website: 'https://x.com' })).toEqual({ fill: {}, additions: [] });
  });

  it('treats everything as blank for a brand-new lead', () => {
    expect(splitContactPatch(undefined, { email: 'a@x.com', city: 'Leeds' })).toEqual({ fill: { email: 'a@x.com', city: 'Leeds' }, additions: [] });
  });
});

describe('customer profile (icp_id) in a patch', () => {
  it('keeps a profile id that belongs to the org and drops an invented one', () => {
    const mk = (icp: string) => [{ type: 'update', lead_id: 'lead-1', business_name: 'Acme', patch: { icp_id: icp }, excerpt: 'x', rationale: 'y' }];
    const allowed = new Set(['real-profile']);
    const kept = sanitizeDreamAgentActions(mk('real-profile'), VALID_IDS, undefined, allowed)[0] as unknown as { patch: Record<string, unknown> };
    const dropped = sanitizeDreamAgentActions(mk('made-up'), VALID_IDS, undefined, allowed)[0] as unknown as { patch: Record<string, unknown> };
    expect(kept.patch.icp_id).toBe('real-profile');
    expect(dropped.patch).not.toHaveProperty('icp_id');
  });
});
