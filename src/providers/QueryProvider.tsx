import React, { ReactNode, useCallback, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { frontendLogger } from '../logging/Logger';

interface QueryProviderProps {
  children: ReactNode;
}

const LazyDevtools = React.lazy(() =>
  import('@tanstack/react-query-devtools').then((module) => ({
    default: module.ReactQueryDevtools,
  }))
);

let _queryConfig = {
  staleTime: 5 * 60 * 1000,
  gcTime: 10 * 60 * 1000,
};

let _queryClient: QueryClient | null = null;
let globalResetFunction: (() => void) | null = null;
let queryClient: QueryClient;

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: _queryConfig.staleTime,
        gcTime: _queryConfig.gcTime,
        retry: (failureCount, error: Error & { status?: number }) => {
          if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) {
            return false;
          }

          return failureCount < 3;
        },
        refetchOnWindowFocus: false,
        refetchOnMount: true,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function syncQueryClient(client: QueryClient): QueryClient {
  _queryClient = client;
  queryClient = client;
  return client;
}

export function initQueryConfig(config: { staleTime: number; gcTime: number }): void {
  _queryConfig = config;

  if (_queryClient) {
    if (globalResetFunction) {
      globalResetFunction();
      return;
    }

    syncQueryClient(createQueryClient());
  }
}

export function getQueryClient(): QueryClient {
  if (!_queryClient) {
    return syncQueryClient(createQueryClient());
  }

  return _queryClient;
}

export const resetQueryClient = (): void => {
  if (globalResetFunction) {
    globalResetFunction();
    return;
  }

  syncQueryClient(createQueryClient());
  frontendLogger.warning(
    'QueryClient reset via fallback - component reset function not available',
    'QueryProvider'
  );
};

export const _setResetFunction = (resetFn: () => void): void => {
  globalResetFunction = resetFn;
};

export const _clearResetFunction = (): void => {
  globalResetFunction = null;
};

export const QueryProvider: React.FC<QueryProviderProps> = ({ children }) => {
  const [client, setClient] = useState(() => getQueryClient());

  const resetClient = useCallback(() => {
    const nextClient = syncQueryClient(createQueryClient());
    setClient(nextClient);
  }, []);

  React.useEffect(() => {
    _setResetFunction(resetClient);

    return () => {
      _clearResetFunction();
    };
  }, [resetClient]);

  return (
    <QueryClientProvider client={client}>
      {children}
      {import.meta.env.DEV && (
        <React.Suspense fallback={null}>
          <LazyDevtools initialIsOpen={false} />
        </React.Suspense>
      )}
    </QueryClientProvider>
  );
};

export { queryClient };
