/** The older address the app was first published on. It still serves the app, but sign-in and sessions belong to one address, so people are moved off it. */
export const LEGACY_HOST = 'dreamlabs-sales.kevindigitalinflux.workers.dev';
/** The address everyone should use. */
export const MAIN_ORIGIN = 'https://sales.didreamlabs.com';

/**
 * Where to send a visitor who opened the old workers.dev address: the same path, query and `#` part on the main
 * address. The `#` part matters because a sign-in that was returned to the old address travels in it, so the person
 * arrives on the main address already signed in. Returns null for every other address (the main address, localhost,
 * Cloudflare preview addresses, anything that only contains the old host's name) and for text that is not a web address.
 */
export function canonicalRedirect(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.hostname !== LEGACY_HOST) return null;
  return `${MAIN_ORIGIN}${url.pathname}${url.search}${url.hash}`;
}
