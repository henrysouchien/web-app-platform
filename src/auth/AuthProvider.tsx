import React, { useEffect, type ReactNode } from 'react';
import type { AuthStoreHook } from './createAuthStore';

export function createAuthProvider<TUser>(useStore: AuthStoreHook<TUser>) {
  return ({ children }: { children: ReactNode }) => {
    const isInitialized = useStore((s) => s.isInitialized);
    const isLoading = useStore((s) => s.isLoading);
    const initializeAuth = useStore((s) => s.initializeAuth);
    const setupCrossTabSync = useStore((s) => s.setupCrossTabSync);
    const teardownCrossTabSync = useStore((s) => s.teardownCrossTabSync);

    useEffect(() => {
      setupCrossTabSync();
      return () => teardownCrossTabSync();
    }, [setupCrossTabSync, teardownCrossTabSync]);

    useEffect(() => {
      if (!isInitialized && !isLoading) initializeAuth();
    }, [initializeAuth, isInitialized, isLoading]);

    if (!isInitialized) {
      return <div className="auth-initializing">
        <div className="loading-spinner">Checking authentication...</div>
      </div>;
    }
    return <>{children}</>;
  };
}
