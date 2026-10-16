/** Log only a bounded error code, never provider messages or payloads. */
export function deepFindErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(error.code) ? error.code : undefined;
}

export function logDeepFindError(context: string, error: unknown): void {
  const code = deepFindErrorCode(error);
  if (code) console.error(context, code);
  else console.error(context);
}
