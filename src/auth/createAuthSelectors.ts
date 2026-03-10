import { shallow } from 'zustand/shallow';
import type { AuthState, AuthStoreHook } from './createAuthStore';

export function createAuthSelectors<TUser>(useStore: AuthStoreHook<TUser>) {
  return {
    useUser: () => useStore((s) => s.user),
    useAuthStatus: () => useStore((s) => ({
      isAuthenticated: s.isAuthenticated,
      isLoading: s.isLoading,
      error: s.error,
    }), shallow),
    useAuthActions: () => useStore((s) => ({
      signIn: s.signIn,
      signOut: s.signOut,
      setUser: s.setUser,
      setLoading: s.setLoading,
      setError: s.setError,
      clearError: s.clearError,
      initializeAuth: s.initializeAuth,
      setupCrossTabSync: s.setupCrossTabSync,
      teardownCrossTabSync: s.teardownCrossTabSync,
    }), shallow),
  };
}
