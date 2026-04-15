import { ClassValue } from 'clsx';
import React, { ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { UseBoundStoreWithEqualityFn } from 'zustand/traditional';
import { StoreApi } from 'zustand';
import * as react_jsx_runtime from 'react/jsx-runtime';

/**
 * Frontend Logger Service
 *
 * Pipes all frontend logs to the backend terminal for unified debugging visibility.
 * Mirrors the backend logging structure with categories and structured data.
 */
type LogLevel = 'debug' | 'info' | 'warning' | 'error';
type LogCategory = 'component' | 'adapter' | 'state' | 'performance' | 'error' | 'network' | 'user';
declare class FrontendLogger {
    private baseUrl;
    private initialized;
    private readonly isEnabled;
    private readonly isProduction;
    private readonly sessionId;
    private logQueue;
    private preInitBuffer;
    private isProcessingQueue;
    private queueFlushTimer;
    private sessionLifecycleStarted;
    private currentUserId;
    private sessionStartTime;
    private readonly SESSION_SUMMARY_INTERVAL_MS;
    private readonly QUEUE_FLUSH_DEBOUNCE_MS;
    private _routeTimings;
    private _navigationEpoch;
    private readonly SENSITIVE_KEYS;
    private readonly JWT_PATTERN;
    private readonly MAX_DATA_VALUE_LENGTH;
    private readonly MAX_DATA_ARRAY_ITEMS;
    private readonly MAX_SANITIZE_DEPTH;
    private readonly SUPPRESSED_COMPONENTS;
    private readonly SUPPRESSED_MESSAGES;
    private suppressionCounts;
    private lastSuppressionFlush;
    private readonly SUPPRESSION_FLUSH_INTERVAL_MS;
    private suppressionEnabled;
    private readonly DEDUP_WINDOW_MS;
    private readonly DEDUP_MAX_ENTRIES;
    private readonly DEDUP_CATEGORIES;
    private recentLogs;
    private readonly CONTEXT_BUFFER_SIZE;
    private contextBuffer;
    private sessionStats;
    /**
     * Starts backend log shipping and lifecycle tracking.
     * Console logging works before init; backend shipping is buffered until init runs.
     */
    init(config: {
        baseUrl: string;
    }): void;
    private generateSessionId;
    /**
     * Set the current user ID for all subsequent logs
     * Call this when user logs in
     * @param userId - Authenticated user ID to attach to frontend log entries
     */
    setUserId(userId: string): void;
    /**
     * Clear the current user ID
     * Call this when user logs out
     */
    clearUserId(): void;
    /**
     * Get current user ID (set via setUserId)
     * @returns The current authenticated user ID, or undefined when not signed in
     */
    private getCurrentUserId;
    private setupConsoleLogging;
    private startSessionLifecycle;
    private readonly handleBeforeUnload;
    private readonly handleVisibilityChange;
    private getCurrentPath;
    private buildPayload;
    private buildDataSummary;
    private sanitize;
    private truncateData;
    private maybeFlushSuppressionSummary;
    setSuppression(enabled: boolean): void;
    private isDuplicate;
    private addToContextBuffer;
    private addErrorContext;
    private getSessionSummaryData;
    private emitSessionSummary;
    /**
     * COMPONENT LOGGING - Track component lifecycle and interactions
     */
    component: {
        mounted: (componentName: string, props?: unknown) => void;
        unmounted: (componentName: string) => void;
        stateChange: (componentName: string, oldState: unknown, newState: unknown) => void;
        error: (componentName: string, error: Error, errorInfo?: unknown) => void;
    };
    /**
     * ADAPTER LOGGING - Track data transformations and API interactions
     */
    adapter: {
        transformStart: (adapterName: string, inputData: unknown, operation?: string) => void;
        transformSuccess: (adapterName: string, outputData: unknown, operation?: string) => void;
        transformError: (adapterName: string, error: Error, inputData?: unknown) => void;
        apiCall: (adapterName: string, endpoint: string, params?: unknown) => void;
    };
    /**
     * STATE MANAGEMENT LOGGING - Track Zustand store changes
     */
    state: {
        storeUpdate: (storeName: string, action: string, oldState: unknown, newState: unknown) => void;
        subscriptionChange: (storeName: string, subscriberComponent: string, selectedData: unknown) => void;
        cacheHit: (storeName: string, key: string) => void;
        cacheMiss: (storeName: string, key: string) => void;
    };
    /**
     * PERFORMANCE LOGGING - Track slow operations and rendering
     */
    performance: {
        measureStart: (_operationName: string, _component?: string) => number;
        measureEnd: (operationName: string, startTime: number, component?: string) => void;
        slowRender: (componentName: string, renderTime: number, props?: unknown) => void;
    };
    /**
     * ROUTE TIMING - Measure navigation-to-data-settled latency per view
     */
    routeTiming: {
        start: (viewName: string) => void;
        end: (viewName: string) => void;
        /** Check if a route timing is in progress */
        isActive: (viewName: string) => boolean;
    };
    /** Reset the navigation epoch (called automatically by routeTiming.start) */
    resetNavigationEpoch(): void;
    /** Get elapsed ms since the current navigation epoch */
    getNavigationElapsed(): number;
    /**
     * NETWORK LOGGING - Track API calls and responses
     */
    network: {
        request: (url: string, method: string, data?: unknown, component?: string) => void;
        response: (url: string, status: number, responseTime: number, component?: string) => void;
        error: (url: string, error: Error, component?: string) => void;
        waterfall: (endpoint: string, relativeStartMs: number, durationMs: number) => void;
    };
    /**
     * USER INTERACTION LOGGING - Track user actions
     */
    user: {
        action: (action: string, component: string, data?: unknown) => void;
        navigation: (from: string, to: string) => void;
    };
    /**
     * GENERIC LOGGING METHODS
     * @param message
     * @param component
     * @param data
     */
    debug(message: string, component?: string, data?: unknown): void;
    info(message: string, component?: string, data?: unknown): void;
    warning(message: string, component?: string, data?: unknown): void;
    error(message: string, component?: string, error?: unknown, data?: unknown): void;
    /**
     * CONVENIENCE METHODS - Properly typed alternatives to dynamic assignments
     * @param component
     * @param message
     * @param data
     */
    logComponent(component: string, message: string, data?: unknown): void;
    logUser(component: string, message: string, data?: unknown): void;
    logPerformance(component: string, message: string, data?: unknown): void;
    logAdapter(component: string, message: string, data?: unknown): void;
    logError(component: string, message: string, error?: unknown): void;
    logNetwork(component: string, message: string, data?: unknown): void;
    /**
     * CORE LOGGING METHOD
     * @param logData
     */
    private log;
    private queueLog;
    private flushPreInitBuffer;
    private scheduleQueueFlush;
    private clearQueueFlushTimer;
    private flushQueuedLogsWithBeacon;
    private sendBeaconBatch;
    private processQueue;
    private sendBatch;
}
/**
 * Singleton instance of FrontendLogger.
 *
 * USAGE:
 * ======
 * Primary logging interface for all frontend components. Provides structured,
 * categorized logging that pipes to both browser console and backend terminal
 * for unified debugging visibility across the entire application stack.
 *
 * ARCHITECTURAL INTEGRATION:
 * =========================
 * • Mirrors backend logging structure for consistent debugging experience
 * • Includes AI guidance hints based on architectural layer detection
 * • Provides user-scoped logging with session tracking
 * • Integrates with performance monitoring and error tracking
 *
 * CATEGORIES & METHODS:
 * =====================
 * • frontendLogger.component.* - React component lifecycle, rendering, state
 * • frontendLogger.adapter.* - Data transformation, API integration
 * • frontendLogger.state.* - Store updates, subscriptions, side effects
 * • frontendLogger.performance.* - Timing, slow renders, bottlenecks
 * • frontendLogger.network.* - API calls, responses, network errors
 * • frontendLogger.user.* - User interactions, navigation, actions
 * • frontendLogger.debug/info/warning/error() - Generic logging levels
 */
declare const frontendLogger: FrontendLogger;
/**
 * Convenience alias for the frontend logger.
 *
 * USAGE:
 * ======
 * Shorter import alias for quick debugging and prototyping.
 * Equivalent to `frontendLogger` but with less typing.
 *
 * EXAMPLES:
 * =========
 * ```typescript
 * import { log } from '../services/frontendLogger';
 *
 * // Quick debugging
 * log.debug('Component rendered', 'MyComponent', { props });
 * log.error('API failed', 'DataService', error);
 *
 * // Performance tracking
 * const start = log.performance.measureStart('data-processing');
 * // ... processing ...
 * log.performance.measureEnd('data-processing', start);
 * ```
 * @alias frontendLogger
 */
declare const log: FrontendLogger;

interface CacheEvent {
    type: 'cache-invalidated' | 'cache-cleared' | 'data-updated' | 'adapter-cleared' | 'user-logout';
    source: 'coordinator' | 'adapter' | 'service' | 'component';
    scopeId?: string;
    dataType?: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
}
type EventHandler<T = CacheEvent> = (data: T) => void;
declare class EventBus {
    private listeners;
    on<T = CacheEvent>(event: string, handler: EventHandler<T>): () => void;
    emit<T = CacheEvent>(event: string, data: T): void;
    off<T = CacheEvent>(event: string, handler: EventHandler<T>): void;
    clear(event?: string): void;
    getListenerCount(event?: string): number;
    getActiveListenerCount(): number;
    getListenersByEvent(): Record<string, number>;
}

interface CacheEntry<T = unknown> {
    value: T;
    timestamp: number;
    ttl: number;
    scopeId?: string;
    dataType?: string;
}
interface CacheStats {
    totalEntries: number;
    hitCount: number;
    missCount: number;
    hitRatio: number;
    entriesByType: Record<string, number>;
    entriesByScope: Record<string, number>;
}
interface CachePerformanceMetrics {
    hitRatio: number;
    avgResponseTime: number;
    totalRequests: number;
    errorRate: number;
    entriesByType: Record<string, {
        hits: number;
        misses: number;
        errors: number;
    }>;
    recentOperations: Array<{
        timestamp: number;
        operation: 'hit' | 'miss' | 'clear' | 'error';
        key: string;
        responseTime?: number;
        dataType?: string;
    }>;
}
declare class UnifiedCache {
    private eventBus;
    private cache;
    private performanceMetrics;
    constructor(eventBus: EventBus);
    get<T>(key: string, factory: () => T, ttl: number, metadata?: {
        scopeId?: string;
        dataType?: string;
    }): T;
    set<T>(key: string, value: T, ttl: number, metadata?: {
        scopeId?: string;
        dataType?: string;
    }): void;
    delete(key: string): boolean;
    clearByType(dataType: string, scopeId?: string): number;
    clearByPattern(pattern: RegExp): number;
    clearScope(scopeId: string): number;
    clear(): void;
    has(key: string): boolean;
    inspect(key: string): CacheEntry | null;
    getKeys(): string[];
    private recordOperation;
    getStats(): CacheStats;
    getPerformanceMetrics(): CachePerformanceMetrics;
}

interface CacheMetrics {
    layer: string;
    operation: 'hit' | 'miss' | 'set' | 'clear' | 'invalidate';
    key: string;
    responseTime: number;
    dataType?: string;
    scopeId?: string;
    timestamp: number;
    cacheSize?: number;
    memoryUsage?: number;
}
interface LayerPerformance {
    layer: string;
    totalOperations: number;
    hits: number;
    misses: number;
    hitRatio: number;
    avgResponseTime: number;
    totalResponseTime: number;
    cacheSize: number;
    memoryUsage: number;
    lastActivity: number;
}
interface CachePerformanceReport {
    reportId: string;
    generatedAt: number;
    timeRange: {
        start: number;
        end: number;
        durationMs: number;
    };
    layers: LayerPerformance[];
    summary: {
        totalOperations: number;
        overallHitRatio: number;
        avgResponseTime: number;
        totalMemoryUsage: number;
        mostActiveLayer: string;
        slowestLayer: string;
        recommendations: string[];
    };
    recentOperations: CacheMetrics[];
}
interface CacheAlerts {
    lowHitRatio: {
        layer: string;
        ratio: number;
        threshold: number;
    }[];
    slowOperations: {
        layer: string;
        avgTime: number;
        threshold: number;
    }[];
    highMemoryUsage: {
        layer: string;
        usage: number;
        threshold: number;
    }[];
    frequentMisses: {
        key: string;
        count: number;
        layer: string;
    }[];
}
declare class CacheMonitorBase {
    private eventBus;
    private config;
    private metrics;
    private layerStats;
    private readonly maxMetricsHistory;
    private readonly alertThresholds;
    constructor(eventBus: EventBus, config: {
        eventNames: string[];
    });
    private setupEventListeners;
    trackCacheHit(layer: string, key: string, responseTime: number, dataType?: string, scopeId?: string): void;
    trackCacheMiss(layer: string, key: string, fetchTime: number, dataType?: string, scopeId?: string): void;
    private trackCacheOperation;
    private updateLayerStats;
    generateReport(timeRangeMs?: number): CachePerformanceReport;
    private generateRecommendations;
    getAlerts(): CacheAlerts;
    private getFrequentMisses;
    getRealtimeStats(): {
        layers: LayerPerformance[];
        alerts: CacheAlerts;
    };
    clearMetrics(): void;
    getLayerMetrics(layer: string): CacheMetrics[];
    getScopeMetrics(scopeId: string): CacheMetrics[];
}

interface CacheCoordinatorLike {
    clearAll?: () => void;
}
interface CacheStateReport {
    reportId: string;
    timestamp: number;
    layers: LayerState[];
    summary: {
        totalKeys: number;
        totalMemoryUsage: number;
        oldestEntry: number;
        newestEntry: number;
        layerCount: number;
    };
    keyCollisions: KeyCollision[];
    recommendations: string[];
}
interface LayerState {
    layer: string;
    keyCount: number;
    memoryUsage: number;
    oldestEntry: number;
    newestEntry: number;
    keys: CacheKeyInfo[];
    health: 'healthy' | 'warning' | 'critical';
    issues: string[];
}
interface CacheKeyInfo {
    key: string;
    dataType?: string;
    scopeId?: string;
    size: number;
    age: number;
    ttl: number;
    hitCount: number;
    lastAccessed: number;
    isExpired: boolean;
}
interface KeyCollision {
    key: string;
    layers: string[];
    potentialConflict: boolean;
    recommendation: string;
}
interface InvalidationFlowDiagram {
    trigger: string;
    scopeId: string;
    timestamp: number;
    steps: InvalidationStep[];
    duration: number;
    success: boolean;
    errors: string[];
}
interface InvalidationStep {
    step: number;
    layer: string;
    operation: string;
    startTime: number;
    endTime: number;
    duration: number;
    success: boolean;
    keysAffected: string[];
    error?: string;
}
interface DebugSession {
    sessionId: string;
    startTime: number;
    operations: DebugOperation[];
    filters: DebugFilters;
    isActive: boolean;
}
interface DebugOperation {
    timestamp: number;
    layer: string;
    operation: 'get' | 'set' | 'clear' | 'invalidate';
    key: string;
    scopeId?: string;
    dataType?: string;
    duration: number;
    success: boolean;
    metadata?: Record<string, unknown>;
}
interface DebugFilters {
    layers?: string[];
    scopeIds?: string[];
    dataTypes?: string[];
    operations?: string[];
    minDuration?: number;
}
declare class CacheDebugger {
    private eventBus;
    private unifiedCache;
    private cacheMonitor;
    private cacheCoordinator?;
    private debugSessions;
    private activeSession;
    private operationHistory;
    private readonly maxHistorySize;
    constructor(eventBus: EventBus, unifiedCache: UnifiedCache, cacheMonitor: CacheMonitorBase, cacheCoordinator?: CacheCoordinatorLike | undefined);
    private setupGlobalDebugging;
    inspectCacheState(): CacheStateReport;
    startDebugSession(filters?: DebugFilters): string;
    stopDebugSession(): DebugSession | null;
    private setupSessionEventListeners;
    visualizeInvalidationFlow(dataType: string): InvalidationFlowDiagram;
    findPerformanceBottlenecks(): {
        slowOperations: DebugOperation[];
        frequentMisses: {
            key: string;
            count: number;
        }[];
        memoryHogs: {
            layer: string;
            usage: number;
        }[];
        recommendations: string[];
    };
    analyzeKeyCollisions(): KeyCollision[];
    clearAllCaches(): void;
    private showHelp;
    private extractCacheKeys;
    private extractQueryCacheKeys;
    private estimateMemoryUsage;
    private assessLayerHealth;
    private identifyLayerIssues;
    private generateRecommendations;
}

interface CacheKeyMetadata {
    scopeId: string;
    dataType: string;
    version?: string;
    userId?: string;
    timestamp?: number;
}
interface StandardCacheKey {
    key: string;
    metadata: CacheKeyMetadata;
}
declare function generateStandardCacheKey(baseKey: string, metadata: CacheKeyMetadata): StandardCacheKey;
declare function parseStandardCacheKey(key: string): {
    dataType: string;
    scopeId: string;
    baseKey: string;
    version: string;
} | null;
declare function validateCacheKeyMetadata(metadata: CacheKeyMetadata): boolean;
declare function generateContentHash(content: unknown): string;
interface CacheEntryMetadata {
    key: string;
    scopeId?: string;
    dataType?: string;
    createdAt: number;
    expiresAt: number;
    accessCount: number;
    lastAccessed: number;
}
interface CacheOperationMetrics {
    operation: 'hit' | 'miss' | 'set' | 'clear' | 'expire';
    key: string;
    dataType?: string;
    scopeId?: string;
    responseTime: number;
    timestamp: number;
    success: boolean;
    error?: string;
}

declare class ServiceContainer {
    private services;
    private serviceFactories;
    hasService(serviceKey: string): boolean;
    register<T>(serviceKey: string, serviceFactory: () => T, allowOverride?: boolean): void;
    safeRegister<T>(serviceKey: string, serviceFactory: () => T): void;
    get<T>(serviceKey: string): T;
    unregister(serviceKey: string): boolean;
    clear(): void;
    reset(): void;
    size(): number;
    getRegisteredServices(): string[];
}

declare class AdapterRegistry {
    private static instances;
    static getAdapter<T>(type: string, args: unknown[], factory: () => T): T;
    static getAdapter<T>(type: string, args: unknown[], factory: (unifiedCache?: UnifiedCache) => T, unifiedCache: UnifiedCache): T;
    static clear(): void;
    static delete(type: string, args: unknown[]): void;
    static size(): number;
    static has(type: string, args: unknown[]): boolean;
}

declare class LogoutBroadcaster {
    private channel;
    constructor();
    broadcastLogout(): void;
    onLogoutBroadcast(callback: () => void): () => void;
    cleanup(): void;
}
declare const logoutBroadcaster: LogoutBroadcaster;
declare const broadcastLogout: () => void;

interface ErrorEnvelope {
    success: boolean;
    error_code?: string;
    message?: string;
    details?: unknown;
}
declare class ErrorAdapter {
    private static isRecord;
    static transformError(error: unknown): ErrorEnvelope;
    static createSuccess(data: unknown): ErrorEnvelope & {
        data: unknown;
    };
    static isError(response: unknown): boolean;
    static getErrorMessage(error: unknown): string;
}

declare function formatCurrency(value: number, opts?: {
    decimals?: number;
    compact?: boolean;
}): string;
declare function formatPercent(value: number, opts?: {
    decimals?: number;
    sign?: boolean;
}): string;
declare function formatNumber(value: number, opts?: {
    decimals?: number;
    sign?: boolean;
}): string;
declare function formatCompact(value: number, opts?: {
    decimals?: number;
    prefix?: string;
}): string;
declare function formatBasisPoints(value: number): string;
declare function formatSharpeRatio(value: number | null | undefined): string;
declare function roundTo(value: number, decimals?: number): number;

declare function cn(...inputs: ClassValue[]): string;

type RetryableHttpError = Error & {
    status?: number;
    retryAfter?: number;
};
interface HttpClientConfig {
    baseURL: string;
    getToken?: () => string | null;
    logger?: FrontendLogger;
    onUnauthorized?: () => void;
}
declare class HttpClient {
    private readonly baseURL;
    private readonly getToken?;
    private readonly logger?;
    private readonly onUnauthorized?;
    constructor(config: HttpClientConfig);
    /** JSON request/response */
    request<T>(endpoint: string, options?: RequestInit): Promise<T>;
    /** Raw Response for SSE streaming */
    requestStream(endpoint: string, options?: RequestInit): Promise<Response>;
    /** Retry with exponential backoff (internal) */
    private fetchWithRetry;
    private createRequestConfig;
    private createHttpError;
    private isRetryableHttpError;
    private isAbortError;
    private normalizeError;
}

interface QueryProviderProps {
    children: ReactNode;
}
declare let queryClient: QueryClient;
declare function initQueryConfig(config: {
    staleTime: number;
    gcTime: number;
}): void;
declare function getQueryClient(): QueryClient;
declare const resetQueryClient: () => void;
declare const _setResetFunction: (resetFn: () => void) => void;
declare const _clearResetFunction: () => void;
declare const QueryProvider: React.FC<QueryProviderProps>;

interface AuthStoreConfig<TUser> {
    /** Map raw API user object to typed TUser */
    mapUser: (raw: unknown) => TUser;
    /** Check for existing session (e.g., cookie-based) */
    checkAuthStatus: () => Promise<{
        authenticated: boolean;
        user: unknown;
    }>;
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
interface AuthState<TUser> {
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
type AuthStoreHook<TUser> = UseBoundStoreWithEqualityFn<StoreApi<AuthState<TUser>>>;
declare function createAuthStore<TUser>(config: AuthStoreConfig<TUser>): AuthStoreHook<TUser>;

declare function createAuthSelectors<TUser>(useStore: AuthStoreHook<TUser>): {
    useUser: () => TUser | null;
    useAuthStatus: () => {
        isAuthenticated: boolean;
        isLoading: boolean;
        error: string | null;
    };
    useAuthActions: () => {
        signIn: (user: TUser, token: string) => void;
        signOut: () => void;
        setUser: (user: TUser | null) => void;
        setLoading: (loading: boolean) => void;
        setError: (error: string | null) => void;
        clearError: () => void;
        initializeAuth: () => Promise<void>;
        setupCrossTabSync: () => void;
        teardownCrossTabSync: () => void;
    };
};

declare function createAuthProvider<TUser>(useStore: AuthStoreHook<TUser>): ({ children }: {
    children: ReactNode;
}) => react_jsx_runtime.JSX.Element;

interface RuntimeConfigSchema<T> {
    parse: (input: unknown) => T;
}
interface RuntimeConfigLoaderOptions<T> {
    /** Zod schema for validation */
    schema: RuntimeConfigSchema<T>;
    /** Build raw config object from environment - called on first load */
    buildRawConfig: () => Record<string, unknown>;
    /** Default config to use when validation fails in dev */
    defaults: T;
    /** Optional logger for error/warning reporting */
    logger?: FrontendLogger;
}
declare function createRuntimeConfigLoader<T>(options: RuntimeConfigLoaderOptions<T>): {
    loadRuntimeConfig: () => T;
    clearConfigCache: () => void;
};

export { AdapterRegistry, type AuthState, type AuthStoreConfig, type AuthStoreHook, type CacheAlerts, type CacheCoordinatorLike, CacheDebugger, type CacheEntry, type CacheEntryMetadata, type CacheEvent, type CacheKeyInfo, type CacheKeyMetadata, type CacheMetrics, CacheMonitorBase, type CacheOperationMetrics, type CachePerformanceMetrics, type CachePerformanceReport, type CacheStateReport, type CacheStats, type DebugFilters, type DebugOperation, type DebugSession, ErrorAdapter, type ErrorEnvelope, EventBus, type EventHandler, FrontendLogger, HttpClient, type InvalidationFlowDiagram, type InvalidationStep, type KeyCollision, type LayerPerformance, type LayerState, type LogCategory, type LogLevel, LogoutBroadcaster, QueryProvider, type RetryableHttpError, ServiceContainer, type StandardCacheKey, UnifiedCache, _clearResetFunction, _setResetFunction, broadcastLogout, cn, createAuthProvider, createAuthSelectors, createAuthStore, createRuntimeConfigLoader, frontendLogger as default, formatBasisPoints, formatCompact, formatCurrency, formatNumber, formatPercent, formatSharpeRatio, frontendLogger, generateContentHash, generateStandardCacheKey, getQueryClient, initQueryConfig, log, logoutBroadcaster, parseStandardCacheKey, queryClient, resetQueryClient, roundTo, validateCacheKeyMetadata };
