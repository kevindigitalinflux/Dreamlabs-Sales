/** Skipped sibling formats add no uncertainty once their person's address has been proved. */
export function queuedChecksCounts(rows: readonly { status: string; verdict?: string | null; reason?: string | null }[]): { queued: number; running: number; valid: number; invalid: number; unconfirmed: number } {
  const counts = { queued: 0, running: 0, valid: 0, invalid: 0, unconfirmed: 0 };
  for (const row of rows) {
    if (row.status === 'skipped' && row.reason === 'person_done') continue;
    if (row.status === 'queued') counts.queued++;
    else if (row.status === 'running') counts.running++;
    else if (row.status === 'skipped' || row.verdict === 'unverifiable') counts.unconfirmed++;
    else if (row.verdict === 'valid' || row.verdict === 'exists') counts.valid++;
    else if (row.verdict === 'invalid' || row.verdict === 'not_found') counts.invalid++;
  }
  return counts;
}

export function queuedChecksText(input: { state: 'loading' | 'error' | 'ready'; queued: number; running: number; valid: number; invalid: number; unconfirmed: number }): string | null {
  if (input.state === 'loading') return null;
  if (input.state === 'error') return 'Background check status is unavailable';
  const remaining = input.queued + input.running;
  if (remaining > 0) return `${remaining} ${remaining === 1 ? 'address' : 'addresses'} still being checked`;
  if (input.valid + input.invalid + input.unconfirmed === 0) return null;
  return `Background checks finished: ${input.valid} confirmed, ${input.invalid} not real, ${input.unconfirmed} could not be confirmed`;
}
