import { describe, expect, it } from 'vitest';
import { buildSessionNotesPrompt } from '../../supabase/functions/_shared/ai';
import { promptContacts } from '../../supabase/functions/_shared/contacts';
import type { Contact } from '../../supabase/functions/_shared/contacts';

function c(over: Partial<Contact>): Contact {
  return {
    id: 'c1', kind: 'person', first_name: 'Ann', last_name: 'Ray', title: 'Owner', label: null, email: 'ann@acme.com', phone: null,
    is_primary: false, include_in_sequences: true, dismissed_at: null, ...over,
  };
}

describe('buildSessionNotesPrompt', () => {
  const prompt = buildSessionNotesPrompt({
    messages: ['I found Andrea Manning\'s email andrea.manning@hok.com but I also want to email london@hok.com for reception'],
    leadIndex: [{ id: 'lead-1', business_name: 'HOK', city: 'London', stage: 'contacted', contacts: [{ id: 'c1', name_or_label: 'Ann Ray', title: 'Owner', email: 'ann@hok.com', kind: 'person', is_primary: true }] }],
    currentCompanyContext: null,
  });

  it('puts each lead\'s contacts in the lead index', () => {
    expect(prompt).toContain('"contacts":[{"id":"c1","name_or_label":"Ann Ray","title":"Owner","email":"ann@hok.com","kind":"person","is_primary":true}]');
  });

  it('documents both new action types with their JSON shapes', () => {
    expect(prompt).toContain('{"type":"add_contact","lead_id":<id from LEAD INDEX>,"kind":"person" or "general",');
    expect(prompt).toContain('{"type":"update_contact","lead_id":<id from LEAD INDEX>,"contact_id":<id from that');
    expect(prompt).toContain('make_primary (true only)');
  });

  it('states the contact rules', () => {
    expect(prompt).toContain('UPDATE an existing contact');
    expect(prompt).toContain('A person\'s own email goes on that person\'s contact');
    expect(prompt).toContain('is a "general" contact');
    expect(prompt).toContain('"Follow up with her and reception" means both exist as contacts');
    expect(prompt).toContain('Never invent an email, phone or name');
    expect(prompt).toContain('"label":"General reception"');
  });

  it('keeps the existing action wording', () => {
    expect(prompt).toContain('1. "update" — confidently matches one of the leads in LEAD INDEX below.');
    expect(prompt).toContain('4. "update_company_context"');
  });
});

describe('promptContacts', () => {
  it('lists usable contacts only, main first, capped', () => {
    const list = [
      c({ id: 'a', email: 'a@x.com' }),
      c({ id: 'dismissed', email: 'd@x.com', dismissed_at: '2026-01-01' }),
      c({ id: 'noemail', email: null }),
      c({ id: 'g', kind: 'general', first_name: null, last_name: null, label: 'Accounts', email: 'Acc@X.com', is_primary: true }),
      c({ id: 'z', email: 'z@x.com' }),
    ];
    expect(promptContacts(list)).toEqual([
      { id: 'g', name_or_label: 'Accounts', title: 'Owner', email: 'acc@x.com', kind: 'general', is_primary: true },
      { id: 'a', name_or_label: 'Ann Ray', title: 'Owner', email: 'a@x.com', kind: 'person', is_primary: false },
      { id: 'z', name_or_label: 'Ann Ray', title: 'Owner', email: 'z@x.com', kind: 'person', is_primary: false },
    ]);
    expect(promptContacts(list, 2).map((x) => x.id)).toEqual(['g', 'a']);
  });
});
