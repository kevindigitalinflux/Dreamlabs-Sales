import { useCallback, useState } from 'react';

function read<T>(key: string, initial: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
}

function write<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private window, quota) — the state still
    // works in memory, it just won't survive leaving the page.
  }
}

/**
 * useState that survives unmounting (e.g. navigating to another screen and
 * back) by mirroring itself into sessionStorage under `key`. Changing `key`
 * (e.g. switching org) swaps to that key's own saved value instead of carrying
 * the previous one across. `initial` should be a stable constant. Storage
 * failures degrade silently to plain in-memory state.
 */
export function usePersistedState<T>(key: string, initial: T) {
  const [state, setState] = useState(() => ({ key, value: read(key, initial) }));

  let current = state;
  if (state.key !== key) {
    current = { key, value: read(key, initial) };
    setState(current);
  }

  const setValue = useCallback((next: T | ((prev: T) => T)) => {
    setState((prev) => {
      const base = prev.key === key ? prev.value : read(key, initial);
      const value = typeof next === 'function' ? (next as (p: T) => T)(base) : next;
      write(key, value);
      return { key, value };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [current.value, setValue] as const;
}
