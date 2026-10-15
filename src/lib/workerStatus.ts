export function workerConnectionStatus(configured: boolean, shared: boolean, host: string | null): string {
  return configured ? host ? `Using your own worker (${host})` : 'Your saved worker connection is not valid'
    : shared ? 'Using the shared worker' : 'Not set up';
}
