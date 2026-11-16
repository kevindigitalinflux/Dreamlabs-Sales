import { useCallback, useState } from 'react';
import { readNavCollapsed, writeNavCollapsed } from '../lib/ui/navCollapse';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch (error) {
    console.warn('Browser storage is unavailable; the menu state will not be remembered.', error);
    return null;
  }
}

/** Whether the desktop menu is collapsed to icons. Open by default; the choice is remembered on this device. */
export function useNavCollapsed(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(() => readNavCollapsed(storage()));
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      writeNavCollapsed(storage(), !prev);
      return !prev;
    });
  }, []);
  return { collapsed, toggle };
}
