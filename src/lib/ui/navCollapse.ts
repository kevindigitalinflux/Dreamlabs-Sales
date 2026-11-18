/** Storage key for the desktop menu's collapsed state (per device, not per account). */
export const NAV_COLLAPSE_KEY = 'dreamlabs.nav.collapsed';

/** True only when the stored value is exactly '1'. Missing, junk or unavailable storage means "open". */
export function readNavCollapsed(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(NAV_COLLAPSE_KEY) === '1';
  } catch (error) {
    console.warn('Menu state could not be read; using the open menu.', error);
    return false;
  }
}

/** Remembers the choice. Storage failures are logged and otherwise ignored: the choice still holds for the session. */
export function writeNavCollapsed(storage: Pick<Storage, 'setItem'> | null, collapsed: boolean): void {
  try {
    storage?.setItem(NAV_COLLAPSE_KEY, collapsed ? '1' : '0');
  } catch (error) {
    console.warn('Menu state could not be saved.', error);
  }
}
