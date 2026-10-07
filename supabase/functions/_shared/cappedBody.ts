// Import-free helpers for reading an HTTP response body with a hard size cap.

/** Default cap on bytes read from a page body. */
export const MAX_BODY_BYTES = 300_000;

/** Cancels an unread response body, ignoring errors. */
export async function cancelBody(res: Response): Promise<void> {
  try { await res.body?.cancel(); } catch { /* ignore */ }
}

/**
 * Reads at most `maxBytes` of a response body as text. The caller's signal stays armed for
 * the whole read, so a slow-drip body is aborted; whatever was read before that is returned.
 */
export async function readCapped(res: Response, signal: AbortSignal, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const all = new Uint8Array(maxBytes);
  let offset = 0;
  try {
    while (offset < maxBytes && !signal.aborted) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const room = maxBytes - offset;
      const slice = value.length > room ? value.subarray(0, room) : value;
      all.set(slice, offset);
      offset += slice.length;
    }
  } catch { /* aborted or network error: keep what we have */ }
  try { await reader.cancel(); } catch { /* ignore */ }
  return new TextDecoder().decode(all.subarray(0, offset));
}
