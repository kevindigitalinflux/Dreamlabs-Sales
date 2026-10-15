import { describe, expect, it, vi } from 'vitest';
import { parseOrgWorkerSecret, resolveWorkerConfig, validateWorkerConnection } from '../../supabase/functions/_shared/workerConfig';

describe('organisation worker config', () => {
  it('parses a trimmed origin and keeps delimiters inside the secret', () => {
    expect(parseOrgWorkerSecret(' https://worker.example.com/path/ | test|only ')).toEqual({ url: 'https://worker.example.com', secret: 'test|only' });
  });
  it.each(['', 'https://worker.example.com', 'http://worker.example.com|test', 'https://127.0.0.1|test',
    'https://10.0.0.1|test', 'https://[::1]|test', 'https://169.254.169.254|test', 'https://intranet.local|test',
    'https://user:password@worker.example.com|test', 'https://worker.example.com|', 'https://worker.example.com|test\r\nheader'])('rejects unsafe or malformed config %s', (value) => {
    expect(parseOrgWorkerSecret(value)).toBeNull();
  });
  const deps = () => ({ own: vi.fn(async () => ({ configured: false, value: null as string | null })),
    fallbackAllowed: vi.fn(async () => true), global: vi.fn(() => ({ url: 'https://shared.example.com', secret: 'test-global' })) });
  it('prefers own config without reading global config', async () => {
    const d = deps(); d.own.mockResolvedValue({ configured: true, value: 'https://own.example.com|test-own' });
    expect((await resolveWorkerConfig(d))?.url).toBe('https://own.example.com');
    expect(d.global).not.toHaveBeenCalled(); expect(d.fallbackAllowed).not.toHaveBeenCalled();
  });
  it('requires the fallback flag and does not read global config without it', async () => {
    const d = deps(); d.fallbackAllowed.mockResolvedValue(false);
    expect(await resolveWorkerConfig(d)).toBeNull(); expect(d.global).not.toHaveBeenCalled();
    d.fallbackAllowed.mockResolvedValue(true);
    expect((await resolveWorkerConfig(d))?.url).toBe('https://shared.example.com');
  });
  it('fails closed for broken own config or failed reads, never shared fallback', async () => {
    const d = deps(); d.own.mockResolvedValue({ configured: true, value: null });
    expect(await resolveWorkerConfig(d)).toBeNull(); expect(d.global).not.toHaveBeenCalled();
    d.own.mockRejectedValue(new Error('fake database failure'));
    await expect(resolveWorkerConfig(d)).rejects.toThrow('fake database failure');
    expect(d.global).not.toHaveBeenCalled();
  });
  it('checks health with a header, timeout and redirects disabled', async () => {
    const request = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await validateWorkerConnection('https://own.example.com|test-only', request)).toBeNull();
    expect(request).toHaveBeenCalledWith('https://own.example.com/health', expect.objectContaining({
      method: 'GET', redirect: 'error', headers: { 'x-worker-secret': 'test-only' }, signal: expect.any(AbortSignal),
    }));
  });
  it('does not fetch unsafe config and never returns raw network/provider errors', async () => {
    const request = vi.fn(async () => { throw new Error('fake-sensitive-error'); });
    expect(await validateWorkerConnection('https://localhost|test', request)).toContain('public HTTPS');
    expect(request).not.toHaveBeenCalled();
    expect(await validateWorkerConnection('https://own.example.com|test', request)).not.toContain('fake-sensitive');
    const rejected = vi.fn(async () => new Response('fake-sensitive-body', { status: 401 }));
    expect(await validateWorkerConnection('https://own.example.com|test', rejected)).toContain('rejected');
  });
});
