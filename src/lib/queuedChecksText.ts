export function queuedChecksText(input: { state: 'loading' | 'error' | 'ready'; queued: number; running: number; valid: number; invalid: number; unconfirmed: number }): string | null {
  if (input.state === 'loading') return null;
  if (input.state === 'error') return 'Background check status is unavailable';
  const remaining = input.queued + input.running;
  if (remaining > 0) return `${remaining} ${remaining === 1 ? 'address' : 'addresses'} still being checked`;
  if (input.valid + input.invalid + input.unconfirmed === 0) return null;
  return `Background checks finished: ${input.valid} confirmed, ${input.invalid} not real, ${input.unconfirmed} could not be confirmed`;
}
