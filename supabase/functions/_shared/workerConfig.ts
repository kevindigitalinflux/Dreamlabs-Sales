import { parseSafeWebsiteUrl } from './hostGuard.ts';
import { readWorkerConfig, type WorkerConfig } from './workerRules.ts';

/** One Vault value; split only once, so a secret may itself contain a pipe. */
export function parseOrgWorkerSecret(value: string | null): WorkerConfig | null {
  if (!value || value.length > 8192) return null;
  const split = value.indexOf('|');
  if (split < 0) return null;
  const address = value.slice(0, split).trim();
  const secret = value.slice(split + 1).trim();
  if (/[\r\n\x00-\x1f\x7f]/.test(secret) || address.length > 2048) return null;
  if (!parseSafeWebsiteUrl(address)) return null;
  return readWorkerConfig(address, secret);
}

/** Worker-only access: never changes paid API key fallback. Invalid entries are ignored. */
export function parseSharedWorkerOrgIds(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((id) => id.trim().toLowerCase())
    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)));
}

export function sharedWorkerAllowed(orgId: string, fallback: boolean, sharedOrgIds: string | undefined): boolean {
  return fallback || parseSharedWorkerOrgIds(sharedOrgIds).has(orgId.toLowerCase());
}

/** Dependencies keep this policy testable without Deno, database imports or real secrets. Errors propagate: fail closed. */
export async function resolveWorkerConfig(deps: {
  orgId: string;
  sharedOrgIds: string | undefined;
  own(): Promise<{ configured: boolean; value: string | null }>;
  fallbackAllowed(): Promise<boolean>;
  global(): WorkerConfig | null;
}): Promise<WorkerConfig | null> {
  const own = await deps.own();
  if (own.configured) return parseOrgWorkerSecret(own.value);
  return sharedWorkerAllowed(deps.orgId, await deps.fallbackAllowed(), deps.sharedOrgIds) ? deps.global() : null;
}

export async function validateWorkerConnection(value: string, request: typeof fetch = fetch): Promise<string | null> {
  const config = parseOrgWorkerSecret(value);
  if (!config) return 'Enter a public HTTPS worker address and a secret.';
  try {
    const response = await request(`${config.url}/health`, { method: 'GET', redirect: 'error',
      headers: { 'x-worker-secret': config.secret }, signal: AbortSignal.timeout(5000) });
    await response.body?.cancel();
    return response.ok ? null : 'The worker rejected the connection. Check the address and secret.';
  } catch {
    console.error('lookup worker check failed');
    return 'Could not reach the worker. Check the address and try again.';
  }
}
