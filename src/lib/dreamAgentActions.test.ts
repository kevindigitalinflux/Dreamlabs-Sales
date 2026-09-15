import { describe, expect, it } from 'vitest';
import { sanitizeDreamAgentActions } from './dreamAgentActions';

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
    expect(sanitizeDreamAgentActions(raw, VALID_IDS)).toEqual(raw);
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
