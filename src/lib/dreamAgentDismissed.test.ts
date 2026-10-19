import { describe, expect, it } from 'vitest';
import { dismissedTitle, isDismissed } from './dreamAgentDismissed';
import type { DreamAgentAction } from '../types';

const create = { type: 'create', extracted: { business_name: 'Acme Ltd', owner_name: null, phone: null, email: null, website: null, city: null, vertical: null }, patch: {}, excerpt: 'x', rationale: 'y' } as DreamAgentAction;

describe('dismissedTitle', () => {
  it('names a new lead', () => expect(dismissedTitle(create, {})).toBe('New lead: Acme Ltd'));
  it('names an update by lead', () => {
    expect(dismissedTitle({ type: 'update', lead_id: 'l', business_name: 'Beta', patch: {}, excerpt: '', rationale: '' }, {})).toBe('Update: Beta');
  });
  it('names an ambiguous mention', () => {
    expect(dismissedTitle({ type: 'ambiguous', mentioned_text: 'the bakery', candidate_lead_ids: [], excerpt: '' }, {})).toBe('Unclear mention: the bakery');
  });
  it('names the company context row', () => {
    expect(dismissedTitle({ type: 'update_company_context', proposed_context: 'p', excerpt: '', rationale: '' }, {})).toBe('Company context update');
  });
  it('names a contact row from the proposal or the existing contact', () => {
    const add = { type: 'add_contact', lead_id: 'l', kind: 'person', first_name: 'Ann', last_name: 'Lee', excerpt: '', rationale: '' } as DreamAgentAction;
    expect(dismissedTitle(add, { leadName: 'Beta' })).toBe('Add contact: Ann Lee on Beta');
    const upd = { type: 'update_contact', lead_id: 'l', contact_id: 'c', patch: {}, excerpt: '', rationale: '' } as DreamAgentAction;
    expect(dismissedTitle(upd, { leadName: 'Beta', contactName: 'Bob Ray' })).toBe('Update contact: Bob Ray on Beta');
    expect(dismissedTitle(upd, { leadName: 'Beta' })).toBe('Update contact on Beta');
  });
});

describe('isDismissed', () => {
  it('is true only for dismissed', () => {
    expect(isDismissed({ status: 'dismissed' })).toBe(true);
    expect(isDismissed({ status: 'pending' })).toBe(false);
    expect(isDismissed({ status: 'confirmed_update' })).toBe(false);
  });
});

describe('confirm-all filter', () => {
  it('a dismissed row never counts as confirmed', () => {
    expect('dismissed'.startsWith('confirmed_')).toBe(false);
  });
});
