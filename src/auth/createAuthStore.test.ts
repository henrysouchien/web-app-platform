import { describe, expect, it, vi } from 'vitest';
import { createAuthStore } from './createAuthStore';

describe('createAuthStore initializeAuth', () => {
  it('deduplicates concurrent initialization calls', async () => {
    let didCaptureResolver = false;
    let resolveCheck: (value: { authenticated: boolean; user: { id: string } | null }) => void = () => {
      throw new Error('Expected initializeAuth resolver to be captured');
    };
    const checkAuthStatus = vi.fn(
      () =>
        new Promise<{ authenticated: boolean; user: { id: string } | null }>((resolve) => {
          didCaptureResolver = true;
          resolveCheck = resolve;
        })
    );

    const store = createAuthStore<{ id: string }>({
      mapUser: (raw) => raw as { id: string },
      checkAuthStatus,
    });

    const firstInit = store.getState().initializeAuth();
    const secondInit = store.getState().initializeAuth();

    expect(checkAuthStatus).toHaveBeenCalledTimes(1);
    expect(store.getState().isLoading).toBe(true);
    expect(didCaptureResolver).toBe(true);

    resolveCheck({ authenticated: true, user: { id: 'u-1' } });
    await Promise.all([firstInit, secondInit]);

    expect(checkAuthStatus).toHaveBeenCalledTimes(1);
    expect(store.getState().isInitialized).toBe(true);
    expect(store.getState().isAuthenticated).toBe(true);
    expect(store.getState().user).toEqual({ id: 'u-1' });
  });

  it('does not re-run initialization after the store is initialized', async () => {
    const checkAuthStatus = vi.fn().mockResolvedValue({
      authenticated: true,
      user: { id: 'u-2' },
    });

    const store = createAuthStore<{ id: string }>({
      mapUser: (raw) => raw as { id: string },
      checkAuthStatus,
    });

    await store.getState().initializeAuth();
    await store.getState().initializeAuth();

    expect(checkAuthStatus).toHaveBeenCalledTimes(1);
    expect(store.getState().isInitialized).toBe(true);
    expect(store.getState().user).toEqual({ id: 'u-2' });
  });
});
