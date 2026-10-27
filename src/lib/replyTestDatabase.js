// In-memory query double for reply orchestration; records effects and enforces the filters the code emits.
export function replyDatabase(seed = {}) {
  const tables = { email_logs: [], email_replies: [], leads: [], sequence_enrollments: [], lead_notes: [], reply_notifications: [], user_email_settings: [], ...seed };
  const writes = [], queries = [], failures = new Set();
  const service = { rpc: async (name) => ({ data: name === 'reply_alert_recipients' ? [
    { user_id: 'sender', role: 'contractor', can_view: true }, { user_id: 'admin', role: 'admin', can_view: true },
  ] : 'dummy-local-password', error: null }), from(table) {
    let operation = 'select', patch, count = Infinity; const predicates = [];
    const run = () => {
      queries.push({ table, operation });
      if (failures.has(`${table}:${operation}`)) return { data: null, error: { message: 'private-payload' } };
      let rows = (tables[table] ?? []).filter(row => predicates.every(test => test(row))).slice(0, count);
      if (operation === 'insert' || operation === 'upsert') {
        rows = (Array.isArray(patch) ? patch : [patch]).filter(row => !tables[table].some(old =>
          table === 'email_replies' ? old.message_id === row.message_id : table === 'reply_notifications' && old.reply_id === row.reply_id && old.user_id === row.user_id))
          .map(row => ({ id: `${table}-${tables[table].length + 1}`, ...row }));
        tables[table].push(...rows); writes.push({ table, patch });
      }
      if (operation === 'update') { rows.forEach(row => Object.assign(row, patch)); writes.push({ table, patch }); }
      return { data: rows.map(row => ({ ...row })), error: null };
    };
    const q = { select: () => q, eq: (key, value) => { predicates.push(row => row[key] === value); return q; },
      in: (key, values) => { predicates.push(row => values.includes(row[key])); return q; },
      is: (key, value) => { predicates.push(row => (row[key] ?? null) === value); return q; },
      order: () => q, limit: n => { count = n; return q; },
      update: value => { operation = 'update'; patch = value; return q; },
      insert: value => { operation = 'insert'; patch = value; return q; },
      upsert: value => { operation = 'upsert'; patch = value; return q; },
      maybeSingle: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      single: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      then: resolve => resolve(run()) };
    return q;
  } };
  return { service, tables, writes, queries, failures };
}
