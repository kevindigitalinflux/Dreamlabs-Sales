// src/lib/jobs/seen.ts
// Which finished jobs this browser has already shown, per organisation. A per-viewer convenience only: every access is
// wrapped in try/catch and the notification bar works (everything unseen) when storage is missing or blocked.
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SEEN_MAX = 200;
const keyFor = (orgId: string) => `dreamlabs.jobs.seen.${orgId}`;

export function readSeen(storage: StorageLike | null, orgId: string): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(keyFor(orgId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Saves the newest SEEN_MAX entries (insertion order). Never throws. */
export function writeSeen(storage: StorageLike | null, orgId: string, seen: ReadonlySet<string>): void {
  if (!storage) return;
  try {
    storage.setItem(keyFor(orgId), JSON.stringify([...seen].slice(-SEEN_MAX)));
  } catch {
    // storage blocked or full: seen state is a convenience, ignore
  }
}
