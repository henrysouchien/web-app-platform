import { createWithEqualityFn } from 'zustand/traditional';
import type { UseBoundStoreWithEqualityFn } from 'zustand/traditional';
import type { StoreApi } from 'zustand';
import { devtools } from 'zustand/middleware';
import { broadcastLogout, logoutBroadcaster } from '../utils/broadcastLogout';
import type { FrontendLogger } from '../logging/Logger';

export interface AuthStoreConfig<TUser> {
  /** Map raw API user object to typed TUser */
  mapUser: (raw: unknown) => TUser;
  /** Check for existing session (e.g., cookie-based) */
  checkAuthStatus: () => Promise<{ authenticated: boolean; user: unknown }>;
  /** Side effects on sign-in (e.g., logger.setUserId, analytics) */
  onSignIn?: (user: TUser) => void;
  /** Called when signIn succeeds for a previously unauthenticated user.
   *  Use to invalidate stale caches from the expired session. */
  onReauthenticate?: () => void;
  /** Domain cleanup on logout (e.g., logger.clearUserId, registry.clear).
   *  Called from signOut() and handleCrossTabLogout() — NOT from clear().
   *  clear() is raw state reset only. Must be idempotent (safe to call
   *  if already cleaned up, since dual-channel guard may skip second call). */
  onSignOut?: () => void;
  /** Additional side effects specific to cross-tab logout (e.g., session cleanup
   *  that should only run on cross-tab events, not on direct signOut).
   *  Called AFTER onSignOut. */
  onCrossTabLogout?: () => void;
  /** Side effects when initializeAuth finds no active session (e.g., clear stale adapters) */
  onUnauthInit?: () => void;
  /** Logger instance for auth flow logging */
  logger?: FrontendLogger;
}

export interface AuthState<TUser> {
  user: TUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;
  signIn: (user: TUser, token: string) => void;
  signOut: () => void;
  setUser: (user: TUser | null) => void;
  setToken: (token: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  clear: () => void;
  initializeAuth: () => Promise<void>;
  setupCrossTabSync: () => void;
  teardownCrossTabSync: () => void;
  handleCrossTabLogout: () => void;
  isSignedIn: () => boolean;
}

/** Public type alias for the store hook returned by createAuthStore */
export type AuthStoreHook<TUser> = UseBoundStoreWithEqualityFn<StoreApi<AuthState<TUser>>>;

export function createAuthStore<TUser>(config: AuthStoreConfig<TUser>): AuthStoreHook<TUser> {
  // Module-level cross-tab sync state (scoped per store instance via closure)
  let storageHandler: ((e: StorageEvent) => void) | null = null;
  let broadcastCleanup: (() => void) | null = null;
  let isListenerSetup = false;

  return createWithEqualityFn<AuthState<TUser>>()(
    devtools((set, get) => ({
      // Initial state
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      isInitialized: false,

      signIn: (user, token) => {
        const wasUnauthenticated = !get().isAuthenticated && get().isInitialized;
        config.onSignIn?.(user);
        set({ user, token, isAuthenticated: true, error: null, isInitialized: true });
        if (wasUnauthenticated) {
          config.onReauthenticate?.();
        }
      },

      signOut: () => {
        config.logger?.logAdapter?.('authStore', 'signOut');
        broadcastLogout();
        config.onSignOut?.();
        get().clear();
      },

      // clear() is the raw state reset — clears localStorage + Zustand state.
      // Does NOT call onSignOut (callers do that explicitly to avoid
      // double-invocation when signOut → clear).
      clear: () => {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('auth_token');
        }
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          error: null,
          isInitialized: true,
          isLoading: false,
        });
      },

      handleCrossTabLogout: () => {
        // Guard: if already logged out, skip. This prevents double-fire
        // when signOut() triggers both BroadcastChannel and localStorage
        // events — listening tabs receive two cross-tab signals but only
        // process the first.
        if (!get().isAuthenticated && get().isInitialized) return;

        config.logger?.logAdapter?.('authStore', 'Processing cross-tab logout');
        // Same domain cleanup as signOut (logger userId, AdapterRegistry)
        config.onSignOut?.();
        // Additional cross-tab-specific cleanup (session cleanup callback)
        config.onCrossTabLogout?.();
        // Reset state locally (no broadcast — avoids loops)
        get().clear();
      },

      initializeAuth: async () => {
        const state = get();
        if (state.isInitialized) return;
        set({ isLoading: true, error: null });
        try {
          // Outer safety timeout only. Per-call auth timeouts belong in the caller.
          const AUTH_TIMEOUT_MS = 35_000;
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Auth check timed out')), AUTH_TIMEOUT_MS)
          );
          const response = await Promise.race([config.checkAuthStatus(), timeoutPromise]);
          if (response.authenticated && response.user) {
            const user = config.mapUser(response.user);
            config.onSignIn?.(user);
            set({ user, isAuthenticated: true, isInitialized: true, isLoading: false, error: null });
          } else {
            // Unauthenticated init — call onUnauthInit for domain cleanup
            // (e.g., clear stale AdapterRegistry from previous session)
            config.onUnauthInit?.();
            set({ user: null, isAuthenticated: false, isInitialized: true, isLoading: false, error: null });
          }
        } catch (error) {
          config.logger?.logError?.('authStore', 'Auth initialization failed', error);
          set({
            user: null,
            isAuthenticated: false,
            isInitialized: true,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Authentication check failed',
          });
        }
      },

      setupCrossTabSync: () => {
        if (typeof window === 'undefined' || isListenerSetup) return;
        storageHandler = (e: StorageEvent) => {
          if (e.key === 'auth_token' && e.newValue === null) {
            get().handleCrossTabLogout();
          }
        };
        broadcastCleanup = logoutBroadcaster.onLogoutBroadcast(() => {
          get().handleCrossTabLogout();
        });
        window.addEventListener('storage', storageHandler);
        isListenerSetup = true;
      },

      teardownCrossTabSync: () => {
        if (typeof window === 'undefined' || !isListenerSetup) return;
        if (storageHandler) {
          window.removeEventListener('storage', storageHandler);
          storageHandler = null;
        }
        if (broadcastCleanup) {
          broadcastCleanup();
          broadcastCleanup = null;
        }
        isListenerSetup = false;
      },

      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setToken: (token) => set({ token }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      clearError: () => set({ error: null }),
      isSignedIn: () => get().isAuthenticated && !!get().user,
    }), { name: 'auth-store' }),
  );
}
