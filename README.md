# web-app-platform

Generic web application infrastructure for React apps. Provides auth, caching, logging, HTTP, and state management primitives as configurable factories — zero domain coupling.

## Install

```bash
npm install web-app-platform
# or
pnpm add web-app-platform
```

**Peer dependency:** React 18+ or 19+

## What's Included

| Module | Description |
|--------|-------------|
| **Auth** | `createAuthStore<TUser>()`, `createAuthSelectors<TUser>()`, `createAuthProvider<TUser>()` — factory-based auth with callback injection for any user model |
| **Cache** | `UnifiedCache` with scope-aware TTL eviction, `CacheMonitorBase` for hit/miss tracking, `CacheDebugger` for diagnostics |
| **Events** | `EventBus` — generic pub/sub with scoped events |
| **HTTP** | `HttpClient` — fetch wrapper with retry, auth headers, error normalization |
| **Logging** | `FrontendLogger` — pre-init-safe singleton with batched network transport |
| **Providers** | `QueryProvider` — lazy React Query client with `initQueryConfig()` for TTL injection |
| **Config** | `createRuntimeConfigLoader<T>()` — Zod-validated runtime config factory |
| **Services** | `ServiceContainer` — zero-coupling dependency injection |
| **Utils** | `AdapterRegistry`, `broadcastLogout` (cross-tab), `ErrorAdapter`, `cn()`, formatting |

## Quick Start

### Auth Store

```typescript
import { createAuthStore, createAuthProvider } from 'web-app-platform';

interface User {
  id: string;
  email: string;
  name: string;
}

export const useAuthStore = createAuthStore<User>({
  mapUser: (raw) => ({ id: raw.id, email: raw.email, name: raw.name }),
  checkAuthStatus: () => fetch('/api/auth/status').then(r => r.json()),
  onSignIn: (user) => console.log('Signed in:', user.email),
  onSignOut: () => console.log('Signed out'),
});

export const AuthProvider = createAuthProvider(useAuthStore);
```

### Query Provider

```typescript
import { QueryProvider, initQueryConfig } from 'web-app-platform';

// Set domain-specific cache TTLs
initQueryConfig({ staleTime: 300_000, gcTime: 600_000 });

function App() {
  return (
    <QueryProvider>
      <AuthProvider>
        <YourApp />
      </AuthProvider>
    </QueryProvider>
  );
}
```

### HTTP Client

```typescript
import { HttpClient } from 'web-app-platform';

const http = new HttpClient();
const data = await http.get('/api/data');
const result = await http.post('/api/action', { body: { key: 'value' } });
```

### Logger

```typescript
import { frontendLogger } from 'web-app-platform';

// Initialize with your backend endpoint
frontendLogger.init({ baseUrl: 'https://api.example.com' });

// Log anywhere — messages are batched and sent periodically
frontendLogger.info('app', 'User loaded dashboard');
frontendLogger.error('auth', 'Token refresh failed', { error });
```

### Runtime Config

```typescript
import { createRuntimeConfigLoader } from 'web-app-platform';
import { z } from 'zod';

const configSchema = z.object({
  apiBaseUrl: z.string(),
  featureFlags: z.object({ newDashboard: z.boolean() }),
});

export const loadConfig = createRuntimeConfigLoader(configSchema, {
  apiBaseUrl: '/api',
  featureFlags: { newDashboard: false },
});
```

## Key Design Decisions

- **Factory pattern for auth** — `createAuthStore<TUser>()` accepts callbacks (`onSignIn`, `onSignOut`, `onCrossTabLogout`, `onUnauthInit`) so the auth system has zero knowledge of your domain
- **Cross-tab sync** — Dual-channel (BroadcastChannel + localStorage) with dedup guard prevents double-fire
- **Pre-init logger** — Messages are buffered before `init()` is called, then flushed. Safe to import and use anywhere
- **Lazy QueryClient** — Created on first access via `getQueryClient()`, configurable via `initQueryConfig()`
- **Scope-aware caching** — Cache entries tagged with `scopeId` for per-entity eviction (e.g., per-project, per-tenant)

## Requirements

- React 18+ or 19+
- TypeScript 5+
- Zustand ^4.5.0 (included as dependency)
- @tanstack/react-query ^5 (included as dependency)

## License

Proprietary — see [LICENSE](./LICENSE) for details. Commercial use requires explicit written permission. Contact hc@henrychien.com for licensing inquiries.
