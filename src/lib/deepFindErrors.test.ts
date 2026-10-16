import { expect, it, vi } from 'vitest';
import { logDeepFindError } from './deepFindErrors';

it('logs fixed context and a short code without message or details', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  logDeepFindError('review failed', { code: 'PGRST116', message: 'secret', details: 'secret' });
  expect(log).toHaveBeenLastCalledWith('review failed', 'PGRST116');
  for (const code of ['', 'x'.repeat(33), 42, 'Bearer secret', undefined]) {
    logDeepFindError('review failed', { code, message: 'secret' });
    expect(log).toHaveBeenLastCalledWith('review failed');
  }
  log.mockRestore();
});
