import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from './HttpClient';
import { UpgradeRequiredError } from '../errors/UpgradeRequiredError';

describe('HttpClient auth retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries once after a recoverable 401 when auth is still valid', async () => {
    const onUnauthorized = vi.fn();
    const onAuthRetry = vi.fn().mockResolvedValue(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401, statusText: 'Unauthorized' }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient({
      baseURL: 'https://api.example.com',
      onUnauthorized,
      onAuthRetry,
    });

    await expect(client.request<{ ok: boolean }>('/positions')).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onAuthRetry).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('falls back to unauthorized handling after a second 401', async () => {
    const onUnauthorized = vi.fn();
    const onAuthRetry = vi.fn().mockResolvedValue(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401, statusText: 'Unauthorized' }))
      .mockResolvedValueOnce(new Response(null, { status: 401, statusText: 'Unauthorized' }));

    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient({
      baseURL: 'https://api.example.com',
      onUnauthorized,
      onAuthRetry,
    });

    await expect(client.request('/positions')).rejects.toMatchObject({
      message: 'Session expired',
      status: 401,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onAuthRetry).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not retry when retry is disabled', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(new Response(null, { status: 500, statusText: 'Internal Server Error' }));

    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient({
      baseURL: 'https://api.example.com',
    });

    await expect(
      client.request('/upload', { method: 'POST', retry: false })
    ).rejects.toMatchObject({
      message: 'HTTP 500: Internal Server Error',
      status: 500,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws UpgradeRequiredError for upgrade-required 403 responses without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            error: 'upgrade_required',
            tier_required: 'paid',
            tier_current: 'registered',
            message: 'Upgrade to Pro to use AI insights.',
          },
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient({
      baseURL: 'https://api.example.com',
    });

    try {
      await client.request('/positions/ai-recommendations');
    } catch (error) {
      expect(error).toBeInstanceOf(UpgradeRequiredError);
      expect(error).toMatchObject({
        message: 'Upgrade to Pro to use AI insights.',
        status: 403,
        tierRequired: 'paid',
        tierCurrent: 'registered',
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
