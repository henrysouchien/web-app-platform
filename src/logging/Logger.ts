/**
 * Frontend Logger Service
 * 
 * Pipes all frontend logs to the backend terminal for unified debugging visibility.
 * Mirrors the backend logging structure with categories and structured data.
 */

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';
export type LogCategory = 'component' | 'adapter' | 'state' | 'performance' | 'error' | 'network' | 'user';

interface LogData {
  level: LogLevel;
  category: LogCategory;
  message: string;
  component?: string;
  data?: unknown;
  error?: unknown;
}

interface LogPayload extends LogData {
  timestamp: string;
  url: string;
  session?: string;
  userId?: string;
}

export class FrontendLogger {
  private baseUrl = '';
  private initialized = false;
  private readonly isEnabled = import.meta.env.MODE !== 'test';
  private readonly isProduction = import.meta.env.PROD;
  private readonly sessionId = this.generateSessionId();
  private logQueue: LogPayload[] = [];
  private preInitBuffer: LogPayload[] = [];
  private isProcessingQueue = false;
  private queueFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionLifecycleStarted = false;
  private currentUserId: string | undefined = undefined;
  private sessionStartTime = Date.now();
  private _initTimestamp: number | null = null;
  private readonly SESSION_SUMMARY_INTERVAL_MS = 5 * 60 * 1000;
  private readonly QUEUE_FLUSH_DEBOUNCE_MS = 1000;

  // Phase 2A: Route-to-render timing
  private _routeTimings = new Map<string, number>();

  // Phase 2B: Navigation epoch for waterfall-relative request timing
  private _navigationEpoch: number = performance.now();

  private readonly SENSITIVE_KEYS = new Set([
    'token', 'password', 'secret', 'credential', 'authorization', 'cookie',
    'api_key', 'apikey', 'access_token', 'refresh_token'
  ]);
  private readonly JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?/g;
  private readonly MAX_DATA_VALUE_LENGTH = 500;
  private readonly MAX_DATA_ARRAY_ITEMS = 20;
  private readonly MAX_SANITIZE_DEPTH = 5;

  private readonly SUPPRESSED_COMPONENTS = new Set(['EventBus', 'UnifiedAdapterCache']);
  private readonly SUPPRESSED_MESSAGES = new Set([
    'Starting data transformation',
    'Data transformation successful'
  ]);
  private suppressionCounts = new Map<string, number>();
  private lastSuppressionFlush = Date.now();
  private readonly SUPPRESSION_FLUSH_INTERVAL_MS = 30_000;
  private suppressionEnabled = true;

  private readonly DEDUP_WINDOW_MS = 500;
  private readonly DEDUP_MAX_ENTRIES = 100;
  private readonly DEDUP_CATEGORIES = new Set<LogCategory>(['component']);
  private recentLogs = new Map<string, number>();

  private readonly CONTEXT_BUFFER_SIZE = 10;
  private contextBuffer: string[] = [];
  private sessionStats = {
    apiCalls: 0,
    apiErrors: 0,
    totalResponseMs: 0,
    slowestCall: null as { url: string; duration_ms: number } | null,
    userActions: 0,
    warnings: 0,
    errors: 0,
    cacheHits: 0,
    cacheMisses: 0,
    viewsVisited: new Set<string>()
  };

  /**
   * Starts backend log shipping and lifecycle tracking.
   * Console logging works before init; backend shipping is buffered until init runs.
   */
  public init(config: { baseUrl: string }): void {
    const wasInitialized = this.initialized;

    this.baseUrl = config.baseUrl;
    this.initialized = true;

    if (!wasInitialized) {
      this._initTimestamp = Date.now();
      this.sessionStartTime = this._initTimestamp;
      this.flushPreInitBuffer();
    }

    if (!this.sessionLifecycleStarted && this.isEnabled && typeof window !== 'undefined') {
      this.startSessionLifecycle();
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Set the current user ID for all subsequent logs
   * Call this when user logs in
   * @param userId - Authenticated user ID to attach to frontend log entries
   */
  public setUserId(userId: string): void {
    this.currentUserId = userId;
  }

  /**
   * Clear the current user ID
   * Call this when user logs out
   */
  public clearUserId(): void {
    this.currentUserId = undefined;
  }

  /**
   * Get current user ID (set via setUserId)
   * @returns The current authenticated user ID, or undefined when not signed in
   */
  private getCurrentUserId(): string | undefined {
    return this.currentUserId;
  }

  private setupConsoleLogging(): void {
    // Don't override console in development - keep both
    if (import.meta.env.DEV) {
      return;
    }
  }

  private startSessionLifecycle(): void {
    this.sessionLifecycleStarted = true;
    window.setInterval(() => this.emitSessionSummary(), this.SESSION_SUMMARY_INTERVAL_MS);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    this.log({
      level: 'info',
      category: 'performance',
      message: 'Session started',
      component: 'FrontendLogger',
      data: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        screenSize: `${window.innerWidth}x${window.innerHeight}`,
        pathname: window.location.pathname
      }
    });
  }

  private readonly handleBeforeUnload = (): void => {
    if (!this.isEnabled || typeof navigator === 'undefined' || typeof window === 'undefined') {
      return;
    }

    this.maybeFlushSuppressionSummary(true);
    this.flushQueuedLogsWithBeacon();

    const summaryPayload = this.buildPayload({
      level: 'info',
      category: 'performance',
      message: 'Session summary',
      component: 'FrontendLogger',
      data: this.getSessionSummaryData()
    });

    try {
      this.sendBeaconBatch([summaryPayload]);
    } catch {
      // Ignore beacon failures during unload.
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      return;
    }

    this.flushQueuedLogsWithBeacon();
  };

  private getCurrentPath(): string {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.pathname}${window.location.search}`;
  }

  private buildPayload(logData: LogData): LogPayload {
    return {
      ...logData,
      timestamp: new Date().toISOString(),
      url: this.getCurrentPath(),
      session: this.sessionId,
      userId: this.getCurrentUserId()
    };
  }

  private buildDataSummary(data: unknown): Record<string, unknown> {
    if (Array.isArray(data)) {
      return { itemCount: data.length, type: 'array' };
    }

    if (data && typeof data === 'object') {
      const keys = Object.keys(data);
      return {
        itemCount: keys.length,
        type: 'object',
        ...(keys.length > 0 ? { keys: keys.slice(0, 10) } : {})
      };
    }

    if (data === null || data === undefined) {
      return { itemCount: 0, type: data === null ? 'null' : 'undefined' };
    }

    return { itemCount: 1, type: typeof data };
  }

  private sanitize(obj: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
    if (depth > this.MAX_SANITIZE_DEPTH) {
      return '[MaxDepth]';
    }
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return obj.replace(this.JWT_PATTERN, '[REDACTED_JWT]');
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitize(item, depth + 1, seen));
    }

    if (typeof obj === 'object') {
      if (seen.has(obj)) {
        return '[Circular]';
      }
      seen.add(obj);

      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (this.SENSITIVE_KEYS.has(k.toLowerCase())) {
          result[k] = '[REDACTED]';
        } else {
          result[k] = this.sanitize(v, depth + 1, seen);
        }
      }
      return result;
    }

    return obj;
  }

  private truncateData(obj: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
    if (depth > this.MAX_SANITIZE_DEPTH) {
      return '[MaxDepth]';
    }
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string' && obj.length > this.MAX_DATA_VALUE_LENGTH) {
      return `${obj.substring(0, this.MAX_DATA_VALUE_LENGTH)}...[truncated, ${obj.length} chars]`;
    }

    if (Array.isArray(obj)) {
      const truncated = obj.slice(0, this.MAX_DATA_ARRAY_ITEMS).map(item => this.truncateData(item, depth + 1, seen));
      if (obj.length > this.MAX_DATA_ARRAY_ITEMS) {
        truncated.push(`...[${obj.length - this.MAX_DATA_ARRAY_ITEMS} more items]`);
      }
      return truncated;
    }

    if (typeof obj === 'object') {
      if (seen.has(obj)) {
        return '[Circular]';
      }
      seen.add(obj);

      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.truncateData(v, depth + 1, seen);
      }
      return result;
    }

    return obj;
  }

  private maybeFlushSuppressionSummary(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastSuppressionFlush < this.SUPPRESSION_FLUSH_INTERVAL_MS) {
      return;
    }
    if (this.suppressionCounts.size === 0) {
      return;
    }

    const summary = Object.fromEntries(this.suppressionCounts);
    this.suppressionCounts.clear();
    this.lastSuppressionFlush = now;

    this.log({
      level: 'debug',
      category: 'performance',
      message: 'Suppressed log summary',
      component: 'FrontendLogger',
      data: {
        suppressed: summary,
        window_s: this.SUPPRESSION_FLUSH_INTERVAL_MS / 1000
      }
    });
  }

  public setSuppression(enabled: boolean): void {
    this.suppressionEnabled = enabled;
  }

  private isDuplicate(logData: LogData): boolean {
    if (!this.DEDUP_CATEGORIES.has(logData.category)) {
      return false;
    }
    if (logData.message !== 'Component mounted' && logData.message !== 'Component unmounted') {
      return false;
    }

    const key = `${logData.component || 'Unknown'}:${logData.message}`;
    const now = Date.now();
    const lastSeen = this.recentLogs.get(key);

    if (lastSeen && now - lastSeen < this.DEDUP_WINDOW_MS) {
      return true;
    }

    if (this.recentLogs.size >= this.DEDUP_MAX_ENTRIES) {
      const toDelete = Math.floor(this.DEDUP_MAX_ENTRIES / 4);
      const iter = this.recentLogs.keys();
      for (let i = 0; i < toDelete; i++) {
        const staleKey = iter.next().value;
        if (staleKey) {
          this.recentLogs.delete(staleKey);
        }
      }
    }

    this.recentLogs.set(key, now);
    return false;
  }

  private addToContextBuffer(logData: LogData): void {
    if (logData.level === 'debug') {
      return;
    }
    const summary = `${logData.component || 'App'}: ${logData.message}`;
    this.contextBuffer.push(summary);
    if (this.contextBuffer.length > this.CONTEXT_BUFFER_SIZE) {
      this.contextBuffer.shift();
    }
  }

  private addErrorContext(data: unknown): Record<string, unknown> {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return {
        ...data,
        recentContext: [...this.contextBuffer]
      };
    }

    if (data === undefined) {
      return { recentContext: [...this.contextBuffer] };
    }

    return {
      value: data,
      recentContext: [...this.contextBuffer]
    };
  }

  private getSessionSummaryData(): Record<string, unknown> {
    const stats = this.sessionStats;
    const totalCacheEvents = stats.cacheHits + stats.cacheMisses;

    return {
      duration_s: Math.round((Date.now() - this.sessionStartTime) / 1000),
      api_calls: stats.apiCalls,
      api_errors: stats.apiErrors,
      avg_response_ms: stats.apiCalls > 0 ? Math.round(stats.totalResponseMs / stats.apiCalls) : 0,
      slowest_call: stats.slowestCall,
      user_actions: stats.userActions,
      warnings: stats.warnings,
      errors: stats.errors,
      cache_hit_rate: totalCacheEvents > 0
        ? Math.round((stats.cacheHits / totalCacheEvents) * 100) / 100
        : null,
      views_visited: [...stats.viewsVisited]
    };
  }

  private emitSessionSummary(): void {
    this.maybeFlushSuppressionSummary(true);
    this.log({
      level: 'info',
      category: 'performance',
      message: 'Session summary',
      component: 'FrontendLogger',
      data: this.getSessionSummaryData()
    });
  }

  /**
   * COMPONENT LOGGING - Track component lifecycle and interactions
   */
  component = {
    mounted: (componentName: string, props?: unknown) => {
      this.log({
        level: 'debug',
        category: 'component',
        message: `Component mounted`,
        component: componentName,
        data: { props }
      });
    },

    unmounted: (componentName: string) => {
      this.log({
        level: 'debug',
        category: 'component',
        message: `Component unmounted`,
        component: componentName
      });
    },

    stateChange: (componentName: string, oldState: unknown, newState: unknown) => {
      this.log({
        level: 'debug',
        category: 'component',
        message: `State changed`,
        component: componentName,
        data: { oldState, newState }
      });
    },

    error: (componentName: string, error: Error, errorInfo?: unknown) => {
      this.log({
        level: 'error',
        category: 'component',
        message: `Component error: ${error.message}`,
        component: componentName,
        data: { error: error.stack, errorInfo },
        error
      });
    }
  };

  /**
   * ADAPTER LOGGING - Track data transformations and API interactions
   */
  adapter = {
    transformStart: (adapterName: string, inputData: unknown, operation?: string) => {
      this.log({
        level: 'debug',
        category: 'adapter',
        message: operation ? `Transform: ${operation}` : 'Starting data transformation',
        component: adapterName,
        data: this.buildDataSummary(inputData)
      });
    },

    transformSuccess: (adapterName: string, outputData: unknown, operation?: string) => {
      this.log({
        level: 'info',
        category: 'adapter',
        message: operation ? `Transform complete: ${operation}` : 'Data transformation successful',
        component: adapterName,
        data: this.buildDataSummary(outputData)
      });
    },

    transformError: (adapterName: string, error: Error, inputData?: unknown) => {
      this.log({
        level: 'error',
        category: 'adapter',
        message: `Data transformation failed: ${error.message}`,
        component: adapterName,
        data: { inputData, error: error.stack },
        error
      });
    },

    apiCall: (adapterName: string, endpoint: string, params?: unknown) => {
      this.log({
        level: 'debug',
        category: 'adapter',
        message: `API call initiated`,
        component: adapterName,
        data: { endpoint, params }
      });
    }
  };

  /**
   * STATE MANAGEMENT LOGGING - Track Zustand store changes
   */
  state = {
    storeUpdate: (storeName: string, action: string, oldState: unknown, newState: unknown) => {
      this.log({
        level: 'debug',
        category: 'state',
        message: `Store updated: ${action}`,
        component: storeName,
        data: { action, oldState, newState }
      });
    },

    subscriptionChange: (storeName: string, subscriberComponent: string, selectedData: unknown) => {
      this.log({
        level: 'debug',
        category: 'state',
        message: `Component subscribed to store data`,
        component: `${storeName} -> ${subscriberComponent}`,
        data: { selectedData }
      });
    },

    cacheHit: (storeName: string, key: string) => {
      this.sessionStats.cacheHits++;
      this.log({
        level: 'info',
        category: 'state',
        message: `Cache hit`,
        component: storeName,
        data: { key }
      });
    },

    cacheMiss: (storeName: string, key: string) => {
      this.sessionStats.cacheMisses++;
      this.log({
        level: 'info',
        category: 'state',
        message: `Cache miss - fetching data`,
        component: storeName,
        data: { key }
      });
    }
  };

  /**
   * PERFORMANCE LOGGING - Track slow operations and rendering
   */
  performance = {
    measureStart: (_operationName: string, _component?: string) => {
      return performance.now();
    },

    measureEnd: (operationName: string, startTime: number, component?: string) => {
      const duration = performance.now() - startTime;
      const level = duration > 1000 ? 'warning' : 'info';
      
      this.log({
        level,
        category: 'performance',
        message: `Operation completed: ${operationName}`,
        component,
        data: { duration: Math.round(duration), operationName }
      });
    },

    slowRender: (componentName: string, renderTime: number, props?: unknown) => {
      this.log({
        level: 'warning',
        category: 'performance',
        message: `Slow render detected`,
        component: componentName,
        data: { renderTime, props }
      });
    }
  };

  /**
   * ROUTE TIMING - Measure navigation-to-data-settled latency per view
   */
  routeTiming = {
    start: (viewName: string): void => {
      this._routeTimings.set(viewName, performance.now());
      this._navigationEpoch = performance.now();
    },

    end: (viewName: string): void => {
      const startTime = this._routeTimings.get(viewName);
      if (!startTime) return;
      const duration = performance.now() - startTime;
      this._routeTimings.delete(viewName);

      this.log({
        level: duration > 3000 ? 'warning' : 'info',
        category: 'performance',
        message: `Route ready: ${viewName}`,
        component: 'RouteTiming',
        data: {
          view: viewName,
          duration_ms: Math.round(duration),
        },
      });
    },

    /** Check if a route timing is in progress */
    isActive: (viewName: string): boolean => {
      return this._routeTimings.has(viewName);
    },
  };

  /** Reset the navigation epoch (called automatically by routeTiming.start) */
  resetNavigationEpoch(): void {
    this._navigationEpoch = performance.now();
  }

  /** Get elapsed ms since the current navigation epoch */
  getNavigationElapsed(): number {
    return performance.now() - this._navigationEpoch;
  }

  /**
   * NETWORK LOGGING - Track API calls and responses
   */
  network = {
    request: (url: string, method: string, data?: unknown, component: string = 'APIService') => {
      this.log({
        level: 'debug',
        category: 'network',
        message: `${method} request to ${url}`,
        component,
        data: { url, method, requestData: data }
      });
    },

    response: (url: string, status: number, responseTime: number, component: string = 'APIService') => {
      const level = status >= 400 ? 'error' : status >= 300 ? 'warning' : 'info';
      this.sessionStats.apiCalls++;
      if (status >= 400) {
        this.sessionStats.apiErrors++;
      }
      this.sessionStats.totalResponseMs += responseTime;
      if (!this.sessionStats.slowestCall || responseTime > this.sessionStats.slowestCall.duration_ms) {
        this.sessionStats.slowestCall = { url, duration_ms: Math.round(responseTime) };
      }
      
      this.log({
        level,
        category: 'network',
        message: `Response ${status} from ${url}`,
        component,
        data: { url, status, responseTime }
      });
    },

    error: (url: string, error: Error, component: string = 'APIService') => {
      this.sessionStats.apiErrors++;
      this.log({
        level: 'error',
        category: 'network',
        message: `Network error for ${url}: ${error.message}`,
        component,
        data: { url, error: error.stack },
        error
      });
    },

    waterfall: (endpoint: string, relativeStartMs: number, durationMs: number) => {
      this.log({
        level: 'debug',
        category: 'network',
        message: `Waterfall: ${endpoint}`,
        component: 'APIService',
        data: {
          endpoint,
          relative_start_ms: Math.round(relativeStartMs),
          duration_ms: Math.round(durationMs),
          relative_end_ms: Math.round(relativeStartMs + durationMs),
        },
      });
    },
  };

  /**
   * USER INTERACTION LOGGING - Track user actions
   */
  user = {
    action: (action: string, component: string, data?: unknown) => {
      this.sessionStats.userActions++;
      this.log({
        level: 'info',
        category: 'user',
        message: `User action: ${action}`,
        component,
        data
      });
    },

    navigation: (from: string, to: string) => {
      this.sessionStats.viewsVisited.add(to);
      this.log({
        level: 'info',
        category: 'user',
        message: `Navigation: ${from} → ${to}`,
        data: { from, to }
      });
    }
  };

  /**
   * GENERIC LOGGING METHODS
   * @param message
   * @param component
   * @param data
   */
  debug(message: string, component?: string, data?: unknown): void {
    this.log({ level: 'debug', category: 'component', message, component, data });
  }

  info(message: string, component?: string, data?: unknown): void {
    this.log({ level: 'info', category: 'component', message, component, data });
  }

  warning(message: string, component?: string, data?: unknown): void {
    this.log({ level: 'warning', category: 'component', message, component, data });
  }

  error(message: string, component?: string, error?: unknown, data?: unknown): void {
    this.log({ level: 'error', category: 'error', message, component, data, error });
  }

  /**
   * CONVENIENCE METHODS - Properly typed alternatives to dynamic assignments
   * @param component
   * @param message
   * @param data
   */
  logComponent(component: string, message: string, data?: unknown): void {
    this.info(message, component, data);
  }

  logUser(component: string, message: string, data?: unknown): void {
    this.user.action(message, component, data);
  }

  logPerformance(component: string, message: string, data?: unknown): void {
    this.info(message, component, data);
  }

  logAdapter(component: string, message: string, data?: unknown): void {
    this.log({ level: 'info', category: 'adapter', message, component, data });
  }

  logError(component: string, message: string, error?: unknown): void {
    this.error(message, component, error, undefined);
  }

  logNetwork(component: string, message: string, data?: unknown): void {
    this.info(message, component, data);
  }

  /**
   * CORE LOGGING METHOD
   * @param logData
   */
  private log(logData: LogData): void {
    if (!this.isEnabled) return;

    this.maybeFlushSuppressionSummary();
    if (
      this.suppressionEnabled &&
      logData.component &&
      this.SUPPRESSED_COMPONENTS.has(logData.component) &&
      this.SUPPRESSED_MESSAGES.has(logData.message)
    ) {
      this.suppressionCounts.set(
        logData.component,
        (this.suppressionCounts.get(logData.component) ?? 0) + 1
      );
      this.maybeFlushSuppressionSummary();
      return;
    }

    if (this.isDuplicate(logData)) {
      return;
    }

    const enrichedLogData: LogData = {
      ...logData,
      data: logData.level === 'error' ? this.addErrorContext(logData.data) : logData.data
    };

    if (enrichedLogData.data !== undefined) {
      enrichedLogData.data = this.truncateData(this.sanitize(enrichedLogData.data));
    }

    if (enrichedLogData.level === 'warning') {
      this.sessionStats.warnings++;
    } else if (enrichedLogData.level === 'error') {
      this.sessionStats.errors++;
    }

    const currentPath = this.getCurrentPath();
    if (currentPath) {
      this.sessionStats.viewsVisited.add(currentPath);
    }

    this.addToContextBuffer(enrichedLogData);
    const payload = this.buildPayload(enrichedLogData);

    if (!import.meta.env.PROD) {
      const consoleMessage = `[${payload.category.toUpperCase()}] ${payload.component || 'App'}: ${payload.message}`;
      switch (payload.level) {
        case 'error':
          console.error(consoleMessage, payload.data);
          break;
        case 'warning':
          console.warn(consoleMessage, payload.data);
          break;
        case 'debug':
          console.debug(consoleMessage, payload.data);
          break;
        default:
          console.log(consoleMessage, payload.data);
      }
    } else if (payload.level === 'error') {
      console.error(`[${payload.component || 'App'}] ${payload.message}`, payload.data);
    }

    // Queue for backend logging
    if (this.isProduction && logData.category === 'network' && logData.level !== 'error') {
      const duration = (logData.data as any)?.duration_ms;
      if (!duration || duration < 2000) return;
    }

    this.queueLog(payload);
  }

  private queueLog(payload: LogPayload): void {
    if (!this.initialized) {
      this.preInitBuffer.push(payload);
      return;
    }

    this.logQueue.push(payload);
    this.scheduleQueueFlush();
  }

  private flushPreInitBuffer(): void {
    if (!this.initialized || this.preInitBuffer.length === 0) {
      return;
    }

    this.logQueue.push(...this.preInitBuffer);
    this.preInitBuffer = [];
    this.scheduleQueueFlush();
  }

  private scheduleQueueFlush(): void {
    this.clearQueueFlushTimer();
    const elapsedSinceInit = this._initTimestamp === null
      ? Number.POSITIVE_INFINITY
      : Date.now() - this._initTimestamp;
    const delay = elapsedSinceInit < 2000
      ? Math.max(this.QUEUE_FLUSH_DEBOUNCE_MS, 2000 - elapsedSinceInit)
      : this.QUEUE_FLUSH_DEBOUNCE_MS;
    this.queueFlushTimer = setTimeout(() => {
      this.queueFlushTimer = null;
      void this.processQueue();
    }, delay);
  }

  private clearQueueFlushTimer(): void {
    if (this.queueFlushTimer !== null) {
      clearTimeout(this.queueFlushTimer);
      this.queueFlushTimer = null;
    }
  }

  private flushQueuedLogsWithBeacon(): void {
    if (typeof navigator === 'undefined') {
      return;
    }

    this.clearQueueFlushTimer();
    if (this.logQueue.length === 0) {
      return;
    }

    const pendingLogs = this.logQueue.splice(0, this.logQueue.length);
    this.sendBeaconBatch(pendingLogs);
  }

  private sendBeaconBatch(payloads: LogPayload[]): boolean {
    if (payloads.length === 0 || typeof navigator === 'undefined') {
      return false;
    }

    const beaconBody = new Blob([
      JSON.stringify({
        logs: payloads,
        sessionId: this.sessionId,
        flushTime: new Date().toISOString()
      })
    ], { type: 'application/json' });

    return navigator.sendBeacon(`${this.baseUrl}/api/log-frontend`, beaconBody);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.logQueue.length === 0) return;

    // Accumulation gate: if the queue is small and we're still in the startup
    // window, defer the flush to accumulate more entries per batch. This reduces
    // POST count from ~18 to ~3-4 by batching the trickle of adapter logs that
    // arrive as each API response completes.
    const elapsedSinceInit = this._initTimestamp === null
      ? Number.POSITIVE_INFINITY
      : Date.now() - this._initTimestamp;
    if (this.logQueue.length < 10 && elapsedSinceInit < 10_000) {
      this.scheduleQueueFlush();
      return;
    }

    this.clearQueueFlushTimer();
    this.isProcessingQueue = true;

    try {
      while (this.logQueue.length > 0) {
        const batch = this.logQueue.splice(0, 50); // Process in larger batches to reduce request volume

        await this.sendBatch(batch);
      }
    } catch (error) {
      console.error('Failed to process log queue:', error);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async sendBatch(payloads: LogPayload[]): Promise<void> {
    if (payloads.length === 0) {
      return;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // No authentication tokens needed - backend validates via user session
      await fetch(`${this.baseUrl}/api/log-frontend`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          logs: payloads,
          sessionId: this.sessionId,
          flushTime: new Date().toISOString()
        }),
        credentials: 'include' // Include session cookies
      });
    } catch (error) {
      // Fail silently - don't let logging errors crash the app
      console.error('Failed to send log batch to backend:', error);
    }
  }
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
export const frontendLogger = new FrontendLogger();

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
export const log = frontendLogger;
export default frontendLogger; 
