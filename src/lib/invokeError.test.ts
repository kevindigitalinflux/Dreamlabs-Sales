import { describe, expect, it } from 'vitest';
import { readableInvokeError } from './invokeError';

const failure = (message: string, context?: unknown) => Object.assign(new Error(message), { context });

describe('readableInvokeError', () => {
  it('shows the reason the server sent instead of the generic wrapper text', async () => {
    const body = JSON.stringify({ error: 'A user with this email address has already been registered' });
    const err = failure('Edge Function returned a non-2xx status code', new Response(body, { status: 400 }));
    expect(await readableInvokeError(err)).toBe('A user with this email address has already been registered');
  });
  it('falls back to the error text when the body is not JSON or has no reason', async () => {
    expect(await readableInvokeError(failure('Network down', new Response('<html>', { status: 502 })))).toBe('Network down');
    expect(await readableInvokeError(failure('Odd', new Response('{}', { status: 400 })))).toBe('Odd');
  });
  it('has a plain message when there is nothing to read', async () => {
    expect(await readableInvokeError(failure('Plain failure'))).toBe('Plain failure');
    expect(await readableInvokeError(null)).toBe('Something went wrong.');
  });
});
