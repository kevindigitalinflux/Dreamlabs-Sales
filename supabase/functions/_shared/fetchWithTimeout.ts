// supabase/functions/_shared/fetchWithTimeout.ts

/**
 * fetch() with a hard timeout — Deno's fetch has no default one, so a hung
 * socket never rejects and a caller's own try/catch never fires, stalling
 * whatever loop is waiting on it. Same 5s bound already used by
 * websiteContact.ts's scrapeWebsiteContact.
 */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
