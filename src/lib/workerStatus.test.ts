import { expect, it } from 'vitest';
import { workerConnectionStatus } from './workerStatus';
it('shows invalid own connections instead of shared or own-working status', () => {
  expect(workerConnectionStatus(true, true, null)).toBe('Your saved worker connection is not valid');
  expect(workerConnectionStatus(true, true, 'own.example.com')).toBe('Using your own worker (own.example.com)');
  expect(workerConnectionStatus(false, true, null)).toBe('Using the shared worker');
  expect(workerConnectionStatus(false, false, null)).toBe('Not set up');
});
