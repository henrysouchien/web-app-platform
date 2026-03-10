// Logging
export {
  default,
  frontendLogger,
  log,
  type LogLevel,
  type LogCategory,
} from './logging/Logger';
// Export the FrontendLogger class type for config interfaces
export type { FrontendLogger } from './logging/Logger';

// Events
export { EventBus, type CacheEvent, type EventHandler } from './events/EventBus';

// Cache
export {
  UnifiedCache,
  type CacheEntry,
  type CacheStats,
  type CachePerformanceMetrics,
} from './cache/UnifiedCache';
export {
  CacheMonitorBase,
  type CacheMetrics,
  type LayerPerformance,
  type CachePerformanceReport,
  type CacheAlerts,
} from './cache/CacheMonitorBase';
export {
  CacheDebugger,
  type CacheCoordinatorLike,
  type CacheStateReport,
  type LayerState,
  type CacheKeyInfo,
  type KeyCollision,
  type InvalidationFlowDiagram,
  type InvalidationStep,
  type DebugSession,
  type DebugOperation,
  type DebugFilters,
} from './cache/CacheDebugger';
export * from './cache/types';

// Services
export { ServiceContainer } from './services/ServiceContainer';

// Utils
export { AdapterRegistry } from './utils/AdapterRegistry';
export {
  broadcastLogout,
  logoutBroadcaster,
  LogoutBroadcaster,
} from './utils/broadcastLogout';
export { ErrorAdapter, type ErrorEnvelope } from './utils/ErrorAdapter';
export * from './utils/formatting';
export { cn } from './utils/cn';

// HTTP
export { HttpClient, type RetryableHttpError } from './http/HttpClient';

// Providers
export {
  QueryProvider,
  queryClient,
  resetQueryClient,
  getQueryClient,
  initQueryConfig,
  _setResetFunction,
  _clearResetFunction,
} from './providers/QueryProvider';

// Auth
export { createAuthStore, type AuthStoreConfig, type AuthState, type AuthStoreHook } from './auth/createAuthStore';
export { createAuthSelectors } from './auth/createAuthSelectors';
export { createAuthProvider } from './auth/AuthProvider';

// Config
export { createRuntimeConfigLoader } from './config/loadRuntimeConfig';
