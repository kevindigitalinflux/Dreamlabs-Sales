import { expect, it } from 'vitest';
import { loadSequencesAndTemplates } from '../../supabase/functions/_shared/selectedLeadSteps/load';
it('does not offer imported inactive sequences to Autopilot', async () => {
  const client = { from(table) {
    let rows = table === 'email_sequences' ? [{ id: 'active', is_active: true, steps: [] }, { id: 'draft', is_active: false, steps: [] }] : [];
    const query = { select() { return this; }, or() { return this; }, eq(key, value) { rows = rows.filter(row => row[key] === value); return this; },
      then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); } };
    return query;
  } };
  expect((await loadSequencesAndTemplates(client, 'org')).sequences.map(row => row.id)).toEqual(['active']);
});
