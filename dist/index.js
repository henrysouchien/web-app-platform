'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var clsx = require('clsx');
var tailwindMerge = require('tailwind-merge');
var React = require('react');
var reactQuery = require('@tanstack/react-query');
var jsxRuntime = require('react/jsx-runtime');
var traditional = require('zustand/traditional');
var middleware = require('zustand/middleware');
var shallow = require('zustand/shallow');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var React__default = /*#__PURE__*/_interopDefault(React);

// src/logging/Logger.ts
var FrontendLogger = class {
  constructor() {
    this.baseUrl = "";
    this.initialized = false;
    this.isEnabled = undefined.MODE !== "test";
    this.isProduction = undefined.PROD;
    this.sessionId = this.generateSessionId();
    this.logQueue = [];
    this.preInitBuffer = [];
    this.isProcessingQueue = false;
    this.queueFlushTimer = null;
    this.sessionLifecycleStarted = false;
    this.currentUserId = void 0;
    this.sessionStartTime = Date.now();
    this.SESSION_SUMMARY_INTERVAL_MS = 5 * 60 * 1e3;
    this.QUEUE_FLUSH_DEBOUNCE_MS = 200;
    // Phase 2A: Route-to-render timing
    this._routeTimings = /* @__PURE__ */ new Map();
    // Phase 2B: Navigation epoch for waterfall-relative request timing
    this._navigationEpoch = performance.now();
    this.SENSITIVE_KEYS = /* @__PURE__ */ new Set([
      "token",
      "password",
      "secret",
      "credential",
      "authorization",
      "cookie",
      "api_key",
      "apikey",
      "access_token",
      "refresh_token"
    ]);
    this.JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?/g;
    this.MAX_DATA_VALUE_LENGTH = 500;
    this.MAX_DATA_ARRAY_ITEMS = 20;
    this.MAX_SANITIZE_DEPTH = 5;
    this.SUPPRESSED_COMPONENTS = /* @__PURE__ */ new Set(["EventBus", "UnifiedAdapterCache"]);
    this.SUPPRESSED_MESSAGES = /* @__PURE__ */ new Set([
      "Starting data transformation",
      "Data transformation successful"
    ]);
    this.suppressionCounts = /* @__PURE__ */ new Map();
    this.lastSuppressionFlush = Date.now();
    this.SUPPRESSION_FLUSH_INTERVAL_MS = 3e4;
    this.suppressionEnabled = true;
    this.DEDUP_WINDOW_MS = 500;
    this.DEDUP_MAX_ENTRIES = 100;
    this.DEDUP_CATEGORIES = /* @__PURE__ */ new Set(["component"]);
    this.recentLogs = /* @__PURE__ */ new Map();
    this.CONTEXT_BUFFER_SIZE = 10;
    this.contextBuffer = [];
    this.sessionStats = {
      apiCalls: 0,
      apiErrors: 0,
      totalResponseMs: 0,
      slowestCall: null,
      userActions: 0,
      warnings: 0,
      errors: 0,
      cacheHits: 0,
      cacheMisses: 0,
      viewsVisited: /* @__PURE__ */ new Set()
    };
    this.handleBeforeUnload = () => {
      if (!this.isEnabled || typeof navigator === "undefined" || typeof window === "undefined") {
        return;
      }
      this.maybeFlushSuppressionSummary(true);
      this.flushQueuedLogsWithBeacon();
      const summaryPayload = this.buildPayload({
        level: "info",
        category: "performance",
        message: "Session summary",
        component: "FrontendLogger",
        data: this.getSessionSummaryData()
      });
      try {
        this.sendBeaconBatch([summaryPayload]);
      } catch {
      }
    };
    this.handleVisibilityChange = () => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") {
        return;
      }
      this.flushQueuedLogsWithBeacon();
    };
    /**
     * COMPONENT LOGGING - Track component lifecycle and interactions
     */
    this.component = {
      mounted: (componentName, props) => {
        this.log({
          level: "debug",
          category: "component",
          message: `Component mounted`,
          component: componentName,
          data: { props }
        });
      },
      unmounted: (componentName) => {
        this.log({
          level: "debug",
          category: "component",
          message: `Component unmounted`,
          component: componentName
        });
      },
      stateChange: (componentName, oldState, newState) => {
        this.log({
          level: "debug",
          category: "component",
          message: `State changed`,
          component: componentName,
          data: { oldState, newState }
        });
      },
      error: (componentName, error, errorInfo) => {
        this.log({
          level: "error",
          category: "component",
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
    this.adapter = {
      transformStart: (adapterName, inputData, operation) => {
        this.log({
          level: "debug",
          category: "adapter",
          message: operation ? `Transform: ${operation}` : "Starting data transformation",
          component: adapterName,
          data: this.buildDataSummary(inputData)
        });
      },
      transformSuccess: (adapterName, outputData, operation) => {
        this.log({
          level: "info",
          category: "adapter",
          message: operation ? `Transform complete: ${operation}` : "Data transformation successful",
          component: adapterName,
          data: this.buildDataSummary(outputData)
        });
      },
      transformError: (adapterName, error, inputData) => {
        this.log({
          level: "error",
          category: "adapter",
          message: `Data transformation failed: ${error.message}`,
          component: adapterName,
          data: { inputData, error: error.stack },
          error
        });
      },
      apiCall: (adapterName, endpoint, params) => {
        this.log({
          level: "debug",
          category: "adapter",
          message: `API call initiated`,
          component: adapterName,
          data: { endpoint, params }
        });
      }
    };
    /**
     * STATE MANAGEMENT LOGGING - Track Zustand store changes
     */
    this.state = {
      storeUpdate: (storeName, action, oldState, newState) => {
        this.log({
          level: "debug",
          category: "state",
          message: `Store updated: ${action}`,
          component: storeName,
          data: { action, oldState, newState }
        });
      },
      subscriptionChange: (storeName, subscriberComponent, selectedData) => {
        this.log({
          level: "debug",
          category: "state",
          message: `Component subscribed to store data`,
          component: `${storeName} -> ${subscriberComponent}`,
          data: { selectedData }
        });
      },
      cacheHit: (storeName, key) => {
        this.sessionStats.cacheHits++;
        this.log({
          level: "info",
          category: "state",
          message: `Cache hit`,
          component: storeName,
          data: { key }
        });
      },
      cacheMiss: (storeName, key) => {
        this.sessionStats.cacheMisses++;
        this.log({
          level: "info",
          category: "state",
          message: `Cache miss - fetching data`,
          component: storeName,
          data: { key }
        });
      }
    };
    /**
     * PERFORMANCE LOGGING - Track slow operations and rendering
     */
    this.performance = {
      measureStart: (_operationName, _component) => {
        return performance.now();
      },
      measureEnd: (operationName, startTime, component) => {
        const duration = performance.now() - startTime;
        const level = duration > 1e3 ? "warning" : "info";
        this.log({
          level,
          category: "performance",
          message: `Operation completed: ${operationName}`,
          component,
          data: { duration: Math.round(duration), operationName }
        });
      },
      slowRender: (componentName, renderTime, props) => {
        this.log({
          level: "warning",
          category: "performance",
          message: `Slow render detected`,
          component: componentName,
          data: { renderTime, props }
        });
      }
    };
    /**
     * ROUTE TIMING - Measure navigation-to-data-settled latency per view
     */
    this.routeTiming = {
      start: (viewName) => {
        this._routeTimings.set(viewName, performance.now());
        this._navigationEpoch = performance.now();
      },
      end: (viewName) => {
        const startTime = this._routeTimings.get(viewName);
        if (!startTime) return;
        const duration = performance.now() - startTime;
        this._routeTimings.delete(viewName);
        this.log({
          level: duration > 3e3 ? "warning" : "info",
          category: "performance",
          message: `Route ready: ${viewName}`,
          component: "RouteTiming",
          data: {
            view: viewName,
            duration_ms: Math.round(duration)
          }
        });
      },
      /** Check if a route timing is in progress */
      isActive: (viewName) => {
        return this._routeTimings.has(viewName);
      }
    };
    /**
     * NETWORK LOGGING - Track API calls and responses
     */
    this.network = {
      request: (url, method, data, component = "APIService") => {
        this.log({
          level: "debug",
          category: "network",
          message: `${method} request to ${url}`,
          component,
          data: { url, method, requestData: data }
        });
      },
      response: (url, status, responseTime, component = "APIService") => {
        const level = status >= 400 ? "error" : status >= 300 ? "warning" : "info";
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
          category: "network",
          message: `Response ${status} from ${url}`,
          component,
          data: { url, status, responseTime }
        });
      },
      error: (url, error, component = "APIService") => {
        this.sessionStats.apiErrors++;
        this.log({
          level: "error",
          category: "network",
          message: `Network error for ${url}: ${error.message}`,
          component,
          data: { url, error: error.stack },
          error
        });
      },
      waterfall: (endpoint, relativeStartMs, durationMs) => {
        this.log({
          level: "debug",
          category: "network",
          message: `Waterfall: ${endpoint}`,
          component: "APIService",
          data: {
            endpoint,
            relative_start_ms: Math.round(relativeStartMs),
            duration_ms: Math.round(durationMs),
            relative_end_ms: Math.round(relativeStartMs + durationMs)
          }
        });
      }
    };
    /**
     * USER INTERACTION LOGGING - Track user actions
     */
    this.user = {
      action: (action, component, data) => {
        this.sessionStats.userActions++;
        this.log({
          level: "info",
          category: "user",
          message: `User action: ${action}`,
          component,
          data
        });
      },
      navigation: (from, to) => {
        this.sessionStats.viewsVisited.add(to);
        this.log({
          level: "info",
          category: "user",
          message: `Navigation: ${from} \u2192 ${to}`,
          data: { from, to }
        });
      }
    };
  }
  /**
   * Starts backend log shipping and lifecycle tracking.
   * Console logging works before init; backend shipping is buffered until init runs.
   */
  init(config) {
    const wasInitialized = this.initialized;
    this.baseUrl = config.baseUrl;
    this.initialized = true;
    if (!wasInitialized) {
      this.sessionStartTime = Date.now();
      this.flushPreInitBuffer();
    }
    if (!this.sessionLifecycleStarted && this.isEnabled && typeof window !== "undefined") {
      this.startSessionLifecycle();
    }
  }
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  /**
   * Set the current user ID for all subsequent logs
   * Call this when user logs in
   * @param userId - Authenticated user ID to attach to frontend log entries
   */
  setUserId(userId) {
    this.currentUserId = userId;
  }
  /**
   * Clear the current user ID
   * Call this when user logs out
   */
  clearUserId() {
    this.currentUserId = void 0;
  }
  /**
   * Get current user ID (set via setUserId)
   * @returns The current authenticated user ID, or undefined when not signed in
   */
  getCurrentUserId() {
    return this.currentUserId;
  }
  setupConsoleLogging() {
    if (undefined.DEV) {
      return;
    }
  }
  startSessionLifecycle() {
    this.sessionLifecycleStarted = true;
    window.setInterval(() => this.emitSessionSummary(), this.SESSION_SUMMARY_INTERVAL_MS);
    window.addEventListener("beforeunload", this.handleBeforeUnload);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.log({
      level: "info",
      category: "performance",
      message: "Session started",
      component: "FrontendLogger",
      data: {
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        screenSize: `${window.innerWidth}x${window.innerHeight}`,
        pathname: window.location.pathname
      }
    });
  }
  getCurrentPath() {
    if (typeof window === "undefined") {
      return "";
    }
    return `${window.location.pathname}${window.location.search}`;
  }
  buildPayload(logData) {
    return {
      ...logData,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      url: this.getCurrentPath(),
      session: this.sessionId,
      userId: this.getCurrentUserId()
    };
  }
  buildDataSummary(data) {
    if (Array.isArray(data)) {
      return { itemCount: data.length, type: "array" };
    }
    if (data && typeof data === "object") {
      const keys = Object.keys(data);
      return {
        itemCount: keys.length,
        type: "object",
        ...keys.length > 0 ? { keys: keys.slice(0, 10) } : {}
      };
    }
    if (data === null || data === void 0) {
      return { itemCount: 0, type: data === null ? "null" : "undefined" };
    }
    return { itemCount: 1, type: typeof data };
  }
  sanitize(obj, depth = 0, seen = /* @__PURE__ */ new WeakSet()) {
    if (depth > this.MAX_SANITIZE_DEPTH) {
      return "[MaxDepth]";
    }
    if (obj === null || obj === void 0) {
      return obj;
    }
    if (typeof obj === "string") {
      return obj.replace(this.JWT_PATTERN, "[REDACTED_JWT]");
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitize(item, depth + 1, seen));
    }
    if (typeof obj === "object") {
      if (seen.has(obj)) {
        return "[Circular]";
      }
      seen.add(obj);
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        if (this.SENSITIVE_KEYS.has(k.toLowerCase())) {
          result[k] = "[REDACTED]";
        } else {
          result[k] = this.sanitize(v, depth + 1, seen);
        }
      }
      return result;
    }
    return obj;
  }
  truncateData(obj, depth = 0, seen = /* @__PURE__ */ new WeakSet()) {
    if (depth > this.MAX_SANITIZE_DEPTH) {
      return "[MaxDepth]";
    }
    if (obj === null || obj === void 0) {
      return obj;
    }
    if (typeof obj === "string" && obj.length > this.MAX_DATA_VALUE_LENGTH) {
      return `${obj.substring(0, this.MAX_DATA_VALUE_LENGTH)}...[truncated, ${obj.length} chars]`;
    }
    if (Array.isArray(obj)) {
      const truncated = obj.slice(0, this.MAX_DATA_ARRAY_ITEMS).map((item) => this.truncateData(item, depth + 1, seen));
      if (obj.length > this.MAX_DATA_ARRAY_ITEMS) {
        truncated.push(`...[${obj.length - this.MAX_DATA_ARRAY_ITEMS} more items]`);
      }
      return truncated;
    }
    if (typeof obj === "object") {
      if (seen.has(obj)) {
        return "[Circular]";
      }
      seen.add(obj);
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.truncateData(v, depth + 1, seen);
      }
      return result;
    }
    return obj;
  }
  maybeFlushSuppressionSummary(force = false) {
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
      level: "debug",
      category: "performance",
      message: "Suppressed log summary",
      component: "FrontendLogger",
      data: {
        suppressed: summary,
        window_s: this.SUPPRESSION_FLUSH_INTERVAL_MS / 1e3
      }
    });
  }
  setSuppression(enabled) {
    this.suppressionEnabled = enabled;
  }
  isDuplicate(logData) {
    if (!this.DEDUP_CATEGORIES.has(logData.category)) {
      return false;
    }
    if (logData.message !== "Component mounted" && logData.message !== "Component unmounted") {
      return false;
    }
    const key = `${logData.component || "Unknown"}:${logData.message}`;
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
  addToContextBuffer(logData) {
    if (logData.level === "debug") {
      return;
    }
    const summary = `${logData.component || "App"}: ${logData.message}`;
    this.contextBuffer.push(summary);
    if (this.contextBuffer.length > this.CONTEXT_BUFFER_SIZE) {
      this.contextBuffer.shift();
    }
  }
  addErrorContext(data) {
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return {
        ...data,
        recentContext: [...this.contextBuffer]
      };
    }
    if (data === void 0) {
      return { recentContext: [...this.contextBuffer] };
    }
    return {
      value: data,
      recentContext: [...this.contextBuffer]
    };
  }
  getSessionSummaryData() {
    const stats = this.sessionStats;
    const totalCacheEvents = stats.cacheHits + stats.cacheMisses;
    return {
      duration_s: Math.round((Date.now() - this.sessionStartTime) / 1e3),
      api_calls: stats.apiCalls,
      api_errors: stats.apiErrors,
      avg_response_ms: stats.apiCalls > 0 ? Math.round(stats.totalResponseMs / stats.apiCalls) : 0,
      slowest_call: stats.slowestCall,
      user_actions: stats.userActions,
      warnings: stats.warnings,
      errors: stats.errors,
      cache_hit_rate: totalCacheEvents > 0 ? Math.round(stats.cacheHits / totalCacheEvents * 100) / 100 : null,
      views_visited: [...stats.viewsVisited]
    };
  }
  emitSessionSummary() {
    this.maybeFlushSuppressionSummary(true);
    this.log({
      level: "info",
      category: "performance",
      message: "Session summary",
      component: "FrontendLogger",
      data: this.getSessionSummaryData()
    });
  }
  /** Reset the navigation epoch (called automatically by routeTiming.start) */
  resetNavigationEpoch() {
    this._navigationEpoch = performance.now();
  }
  /** Get elapsed ms since the current navigation epoch */
  getNavigationElapsed() {
    return performance.now() - this._navigationEpoch;
  }
  /**
   * GENERIC LOGGING METHODS
   * @param message
   * @param component
   * @param data
   */
  debug(message, component, data) {
    this.log({ level: "debug", category: "component", message, component, data });
  }
  info(message, component, data) {
    this.log({ level: "info", category: "component", message, component, data });
  }
  warning(message, component, data) {
    this.log({ level: "warning", category: "component", message, component, data });
  }
  error(message, component, error, data) {
    this.log({ level: "error", category: "error", message, component, data, error });
  }
  /**
   * CONVENIENCE METHODS - Properly typed alternatives to dynamic assignments
   * @param component
   * @param message
   * @param data
   */
  logComponent(component, message, data) {
    this.info(message, component, data);
  }
  logUser(component, message, data) {
    this.user.action(message, component, data);
  }
  logPerformance(component, message, data) {
    this.info(message, component, data);
  }
  logAdapter(component, message, data) {
    this.log({ level: "info", category: "adapter", message, component, data });
  }
  logError(component, message, error) {
    this.error(message, component, error, void 0);
  }
  logNetwork(component, message, data) {
    this.info(message, component, data);
  }
  /**
   * CORE LOGGING METHOD
   * @param logData
   */
  log(logData) {
    if (!this.isEnabled) return;
    this.maybeFlushSuppressionSummary();
    if (this.suppressionEnabled && logData.component && this.SUPPRESSED_COMPONENTS.has(logData.component) && this.SUPPRESSED_MESSAGES.has(logData.message)) {
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
    const enrichedLogData = {
      ...logData,
      data: logData.level === "error" ? this.addErrorContext(logData.data) : logData.data
    };
    if (enrichedLogData.data !== void 0) {
      enrichedLogData.data = this.truncateData(this.sanitize(enrichedLogData.data));
    }
    if (enrichedLogData.level === "warning") {
      this.sessionStats.warnings++;
    } else if (enrichedLogData.level === "error") {
      this.sessionStats.errors++;
    }
    const currentPath = this.getCurrentPath();
    if (currentPath) {
      this.sessionStats.viewsVisited.add(currentPath);
    }
    this.addToContextBuffer(enrichedLogData);
    const payload = this.buildPayload(enrichedLogData);
    if (!undefined.PROD) {
      const consoleMessage = `[${payload.category.toUpperCase()}] ${payload.component || "App"}: ${payload.message}`;
      switch (payload.level) {
        case "error":
          console.error(consoleMessage, payload.data);
          break;
        case "warning":
          console.warn(consoleMessage, payload.data);
          break;
        case "debug":
          console.debug(consoleMessage, payload.data);
          break;
        default:
          console.log(consoleMessage, payload.data);
      }
    } else if (payload.level === "error") {
      console.error(`[${payload.component || "App"}] ${payload.message}`, payload.data);
    }
    if (this.isProduction && logData.category === "network" && logData.level !== "error") {
      const duration = logData.data?.duration_ms;
      if (!duration || duration < 2e3) return;
    }
    this.queueLog(payload);
  }
  queueLog(payload) {
    if (!this.initialized) {
      this.preInitBuffer.push(payload);
      return;
    }
    this.logQueue.push(payload);
    this.scheduleQueueFlush();
  }
  flushPreInitBuffer() {
    if (!this.initialized || this.preInitBuffer.length === 0) {
      return;
    }
    this.logQueue.push(...this.preInitBuffer);
    this.preInitBuffer = [];
    this.scheduleQueueFlush();
  }
  scheduleQueueFlush() {
    this.clearQueueFlushTimer();
    this.queueFlushTimer = setTimeout(() => {
      this.queueFlushTimer = null;
      void this.processQueue();
    }, this.QUEUE_FLUSH_DEBOUNCE_MS);
  }
  clearQueueFlushTimer() {
    if (this.queueFlushTimer !== null) {
      clearTimeout(this.queueFlushTimer);
      this.queueFlushTimer = null;
    }
  }
  flushQueuedLogsWithBeacon() {
    if (typeof navigator === "undefined") {
      return;
    }
    this.clearQueueFlushTimer();
    if (this.logQueue.length === 0) {
      return;
    }
    const pendingLogs = this.logQueue.splice(0, this.logQueue.length);
    this.sendBeaconBatch(pendingLogs);
  }
  sendBeaconBatch(payloads) {
    if (payloads.length === 0 || typeof navigator === "undefined") {
      return false;
    }
    const beaconBody = new Blob([
      JSON.stringify({
        logs: payloads,
        sessionId: this.sessionId,
        flushTime: (/* @__PURE__ */ new Date()).toISOString()
      })
    ], { type: "application/json" });
    return navigator.sendBeacon(`${this.baseUrl}/api/log-frontend`, beaconBody);
  }
  async processQueue() {
    if (this.isProcessingQueue || this.logQueue.length === 0) return;
    this.clearQueueFlushTimer();
    this.isProcessingQueue = true;
    try {
      while (this.logQueue.length > 0) {
        const batch = this.logQueue.splice(0, 10);
        await this.sendBatch(batch);
      }
    } catch (error) {
      console.error("Failed to process log queue:", error);
    } finally {
      this.isProcessingQueue = false;
    }
  }
  async sendBatch(payloads) {
    if (payloads.length === 0) {
      return;
    }
    try {
      const headers = {
        "Content-Type": "application/json"
      };
      await fetch(`${this.baseUrl}/api/log-frontend`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          logs: payloads,
          sessionId: this.sessionId,
          flushTime: (/* @__PURE__ */ new Date()).toISOString()
        }),
        credentials: "include"
        // Include session cookies
      });
    } catch (error) {
      console.error("Failed to send log batch to backend:", error);
    }
  }
};
var frontendLogger = new FrontendLogger();
var log = frontendLogger;
var Logger_default = frontendLogger;

// src/events/EventBus.ts
var EventBus = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Map();
  }
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, /* @__PURE__ */ new Set());
    }
    this.listeners.get(event).add(handler);
    frontendLogger.adapter.transformSuccess("EventBus", `Subscribed to event: ${event}`);
    return () => {
      const handlers = this.listeners.get(event);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.listeners.delete(event);
        }
        frontendLogger.adapter.transformSuccess("EventBus", `Unsubscribed from event: ${event}`);
      }
    };
  }
  emit(event, data) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
          frontendLogger.adapter.transformSuccess("EventBus", `Event emitted: ${event}`);
        } catch (error) {
          frontendLogger.adapter.transformError("EventBus", error, { event, data });
        }
      });
    } else {
      frontendLogger.adapter.transformStart("EventBus", `No listeners for event: ${event}`);
    }
  }
  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
      frontendLogger.adapter.transformSuccess("EventBus", `Handler removed for event: ${event}`);
    }
  }
  clear(event) {
    if (event) {
      this.listeners.delete(event);
      frontendLogger.adapter.transformSuccess("EventBus", `Cleared all handlers for event: ${event}`);
    } else {
      this.listeners.clear();
      frontendLogger.adapter.transformSuccess("EventBus", "Cleared all event handlers");
    }
  }
  getListenerCount(event) {
    if (event) {
      return this.listeners.get(event)?.size || 0;
    }
    return Array.from(this.listeners.values()).reduce((total, handlers) => total + handlers.size, 0);
  }
  getActiveListenerCount() {
    return Array.from(this.listeners.values()).reduce((total, handlers) => total + handlers.size, 0);
  }
  getListenersByEvent() {
    const result = {};
    this.listeners.forEach((handlers, event) => {
      result[event] = handlers.size;
    });
    return result;
  }
};

// src/cache/UnifiedCache.ts
var UnifiedCache = class {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.cache = /* @__PURE__ */ new Map();
    this.performanceMetrics = {
      totalRequests: 0,
      totalHits: 0,
      totalMisses: 0,
      totalErrors: 0,
      responseTimes: [],
      operationLog: [],
      typeMetrics: /* @__PURE__ */ new Map()
    };
  }
  get(key, factory, ttl, metadata) {
    const startTime = performance.now();
    this.performanceMetrics.totalRequests++;
    try {
      const entry = this.cache.get(key);
      const now = Date.now();
      if (entry && now - entry.timestamp < entry.ttl) {
        const responseTime2 = performance.now() - startTime;
        this.recordOperation("hit", key, responseTime2, metadata?.dataType);
        frontendLogger.adapter.transformSuccess("UnifiedCache", `Cache hit: ${key}`);
        return entry.value;
      }
      frontendLogger.adapter.transformStart("UnifiedCache", `Cache miss: ${key}`);
      const value = factory();
      const responseTime = performance.now() - startTime;
      this.recordOperation("miss", key, responseTime, metadata?.dataType);
      const cacheEntry = {
        value,
        timestamp: now,
        ttl,
        scopeId: metadata?.scopeId,
        dataType: metadata?.dataType
      };
      this.cache.set(key, cacheEntry);
      try {
        this.eventBus.emit("cache-updated", {
          type: "data-updated",
          source: "adapter",
          scopeId: metadata?.scopeId,
          dataType: metadata?.dataType,
          timestamp: now,
          metadata: { key, ttl }
        });
      } catch (error) {
        frontendLogger.adapter.transformError("UnifiedCache", error, {
          operation: "emit-cache-updated",
          key
        });
      }
      frontendLogger.adapter.transformSuccess("UnifiedCache", `Cached: ${key}`);
      return value;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.recordOperation("error", key, responseTime, metadata?.dataType);
      frontendLogger.adapter.transformError("UnifiedCache", error, { key, metadata });
      throw error;
    }
  }
  set(key, value, ttl, metadata) {
    const now = Date.now();
    const cacheEntry = {
      value,
      timestamp: now,
      ttl,
      scopeId: metadata?.scopeId,
      dataType: metadata?.dataType
    };
    this.cache.set(key, cacheEntry);
    try {
      this.eventBus.emit("cache-updated", {
        type: "data-updated",
        source: "adapter",
        scopeId: metadata?.scopeId,
        dataType: metadata?.dataType,
        timestamp: now,
        metadata: { key, ttl }
      });
    } catch (error) {
      frontendLogger.adapter.transformError("UnifiedCache", error, {
        operation: "emit-cache-updated",
        key
      });
    }
    frontendLogger.adapter.transformSuccess("UnifiedCache", `Set cache entry: ${key}`);
  }
  delete(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      frontendLogger.adapter.transformSuccess("UnifiedCache", `Deleted cache entry: ${key}`);
    }
    return deleted;
  }
  clearByType(dataType, scopeId) {
    let clearedCount = 0;
    const keysToDelete = [];
    for (const [key, entry] of Array.from(this.cache.entries())) {
      const matchesType = entry.dataType === dataType;
      const matchesScope = !scopeId || entry.scopeId === scopeId;
      if (matchesType && matchesScope) {
        keysToDelete.push(key);
        clearedCount++;
      }
    }
    keysToDelete.forEach((key) => this.cache.delete(key));
    if (clearedCount > 0) {
      frontendLogger.adapter.transformSuccess(
        "UnifiedCache",
        `Cleared ${clearedCount} entries for type: ${dataType}${scopeId ? `, scope: ${scopeId}` : ""}`
      );
      this.eventBus.emit("cache-cleared", {
        type: "cache-cleared",
        source: "adapter",
        scopeId,
        dataType,
        timestamp: Date.now(),
        metadata: { clearedCount }
      });
    }
    return clearedCount;
  }
  clearByPattern(pattern) {
    let clearedCount = 0;
    const keysToDelete = [];
    for (const key of Array.from(this.cache.keys())) {
      if (pattern.test(key)) {
        keysToDelete.push(key);
        clearedCount++;
      }
    }
    keysToDelete.forEach((key) => this.cache.delete(key));
    if (clearedCount > 0) {
      frontendLogger.adapter.transformSuccess(
        "UnifiedCache",
        `Cleared ${clearedCount} entries matching pattern: ${pattern}`
      );
      this.eventBus.emit("cache-cleared", {
        type: "cache-cleared",
        source: "adapter",
        timestamp: Date.now(),
        metadata: { clearedCount, pattern: pattern.toString() }
      });
    }
    return clearedCount;
  }
  clearScope(scopeId) {
    let clearedCount = 0;
    const keysToDelete = [];
    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (entry.scopeId === scopeId) {
        keysToDelete.push(key);
        clearedCount++;
      }
    }
    keysToDelete.forEach((key) => this.cache.delete(key));
    if (clearedCount > 0) {
      frontendLogger.adapter.transformSuccess("UnifiedCache", `Cleared ${clearedCount} entries for scope: ${scopeId}`);
      this.eventBus.emit("cache-cleared", {
        type: "cache-cleared",
        source: "adapter",
        scopeId,
        timestamp: Date.now(),
        metadata: { clearedCount }
      });
    }
    return clearedCount;
  }
  clear() {
    const clearedCount = this.cache.size;
    this.cache.clear();
    frontendLogger.adapter.transformSuccess("UnifiedCache", `Cleared all cache entries (${clearedCount} total)`);
    this.eventBus.emit("cache-cleared", {
      type: "cache-cleared",
      source: "adapter",
      timestamp: Date.now(),
      metadata: { clearedCount }
    });
  }
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    const now = Date.now();
    const isExpired = now - entry.timestamp >= entry.ttl;
    if (isExpired) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }
  inspect(key) {
    return this.cache.get(key) || null;
  }
  getKeys() {
    return Array.from(this.cache.keys());
  }
  recordOperation(operation, key, responseTime, dataType) {
    if (operation === "hit") {
      this.performanceMetrics.totalHits++;
    }
    if (operation === "miss") {
      this.performanceMetrics.totalMisses++;
    }
    if (operation === "error") {
      this.performanceMetrics.totalErrors++;
    }
    this.performanceMetrics.responseTimes.push(responseTime);
    if (this.performanceMetrics.responseTimes.length > 1e3) {
      this.performanceMetrics.responseTimes.shift();
    }
    if (dataType) {
      if (!this.performanceMetrics.typeMetrics.has(dataType)) {
        this.performanceMetrics.typeMetrics.set(dataType, { hits: 0, misses: 0, errors: 0 });
      }
      const typeStats = this.performanceMetrics.typeMetrics.get(dataType);
      if (operation === "hit") {
        typeStats.hits++;
      } else if (operation === "miss") {
        typeStats.misses++;
      } else if (operation === "error") {
        typeStats.errors++;
      }
    }
    this.performanceMetrics.operationLog.push({
      timestamp: Date.now(),
      operation,
      key,
      responseTime,
      dataType
    });
    if (this.performanceMetrics.operationLog.length > 100) {
      this.performanceMetrics.operationLog.shift();
    }
  }
  getStats() {
    const entriesByType = {};
    const entriesByScope = {};
    for (const entry of Array.from(this.cache.values())) {
      if (entry.dataType) {
        entriesByType[entry.dataType] = (entriesByType[entry.dataType] || 0) + 1;
      }
      if (entry.scopeId) {
        entriesByScope[entry.scopeId] = (entriesByScope[entry.scopeId] || 0) + 1;
      }
    }
    const totalRequests = this.performanceMetrics.totalHits + this.performanceMetrics.totalMisses;
    return {
      totalEntries: this.cache.size,
      hitCount: this.performanceMetrics.totalHits,
      missCount: this.performanceMetrics.totalMisses,
      hitRatio: totalRequests > 0 ? this.performanceMetrics.totalHits / totalRequests : 0,
      entriesByType,
      entriesByScope
    };
  }
  getPerformanceMetrics() {
    const totalRequests = this.performanceMetrics.totalRequests;
    const avgResponseTime = this.performanceMetrics.responseTimes.length > 0 ? this.performanceMetrics.responseTimes.reduce((a, b) => a + b, 0) / this.performanceMetrics.responseTimes.length : 0;
    return {
      hitRatio: totalRequests > 0 ? this.performanceMetrics.totalHits / totalRequests : 0,
      avgResponseTime,
      totalRequests,
      errorRate: totalRequests > 0 ? this.performanceMetrics.totalErrors / totalRequests : 0,
      entriesByType: Object.fromEntries(this.performanceMetrics.typeMetrics),
      recentOperations: [...this.performanceMetrics.operationLog]
    };
  }
};

// src/cache/CacheMonitorBase.ts
var CacheMonitorBase = class {
  constructor(eventBus, config) {
    this.eventBus = eventBus;
    this.config = config;
    this.metrics = [];
    this.layerStats = /* @__PURE__ */ new Map();
    this.maxMetricsHistory = 1e4;
    this.alertThresholds = {
      hitRatio: 0.7,
      responseTime: 1e3,
      memoryUsage: 100 * 1024 * 1024,
      missFrequency: 10
    };
    this.setupEventListeners();
    frontendLogger.adapter.transformSuccess("CacheMonitorBase", "Initialized with event listeners");
  }
  setupEventListeners() {
    this.eventBus.on("cache-updated", (event) => {
      const eventKey = typeof event.metadata?.key === "string" ? event.metadata.key : "unknown";
      this.trackCacheOperation({
        layer: event.source || "unknown",
        operation: "set",
        key: eventKey,
        responseTime: 0,
        dataType: event.dataType,
        scopeId: event.scopeId,
        timestamp: event.timestamp || Date.now()
      });
    });
    this.eventBus.on("cache-cleared", (event) => {
      const metadataPattern = typeof event.metadata?.pattern === "string" ? event.metadata.pattern : null;
      const metadataKey = typeof event.metadata?.key === "string" ? event.metadata.key : null;
      this.trackCacheOperation({
        layer: event.source || "unknown",
        operation: "clear",
        key: metadataPattern || metadataKey || "bulk-clear",
        responseTime: 0,
        dataType: event.dataType,
        scopeId: event.scopeId,
        timestamp: event.timestamp || Date.now()
      });
    });
    Array.from(new Set(this.config.eventNames)).forEach((eventName) => {
      this.eventBus.on(eventName, (event) => {
        this.trackCacheOperation({
          layer: event.source || "coordinator",
          operation: "invalidate",
          key: event.scopeId ? `${eventName}-${event.scopeId}` : eventName,
          responseTime: 0,
          dataType: event.dataType,
          scopeId: event.scopeId,
          timestamp: event.timestamp || Date.now()
        });
      });
    });
  }
  trackCacheHit(layer, key, responseTime, dataType, scopeId) {
    this.trackCacheOperation({
      layer,
      operation: "hit",
      key,
      responseTime,
      dataType,
      scopeId,
      timestamp: Date.now()
    });
  }
  trackCacheMiss(layer, key, fetchTime, dataType, scopeId) {
    this.trackCacheOperation({
      layer,
      operation: "miss",
      key,
      responseTime: fetchTime,
      dataType,
      scopeId,
      timestamp: Date.now()
    });
  }
  trackCacheOperation(metric) {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }
    this.updateLayerStats(metric);
    if (metric.operation === "miss" && metric.responseTime > this.alertThresholds.responseTime) {
      frontendLogger.adapter.transformError("CacheMonitorBase", new Error("Slow cache miss detected"), {
        layer: metric.layer,
        key: metric.key,
        responseTime: metric.responseTime
      });
    }
  }
  updateLayerStats(metric) {
    const layerKey = metric.layer;
    let stats = this.layerStats.get(layerKey);
    if (!stats) {
      stats = {
        layer: layerKey,
        totalOperations: 0,
        hits: 0,
        misses: 0,
        hitRatio: 0,
        avgResponseTime: 0,
        totalResponseTime: 0,
        cacheSize: 0,
        memoryUsage: 0,
        lastActivity: Date.now()
      };
      this.layerStats.set(layerKey, stats);
    }
    stats.totalOperations++;
    stats.lastActivity = metric.timestamp;
    stats.totalResponseTime += metric.responseTime;
    stats.avgResponseTime = stats.totalResponseTime / stats.totalOperations;
    if (metric.operation === "hit") {
      stats.hits++;
    } else if (metric.operation === "miss") {
      stats.misses++;
    }
    const totalHitMissOps = stats.hits + stats.misses;
    if (totalHitMissOps > 0) {
      stats.hitRatio = stats.hits / totalHitMissOps;
    }
    if (metric.cacheSize !== void 0) {
      stats.cacheSize = metric.cacheSize;
    }
    if (metric.memoryUsage !== void 0) {
      stats.memoryUsage = metric.memoryUsage;
    }
  }
  generateReport(timeRangeMs = 3e5) {
    const now = Date.now();
    const startTime = now - timeRangeMs;
    const recentMetrics = this.metrics.filter((m) => m.timestamp >= startTime);
    const layers = Array.from(this.layerStats.values());
    const totalOperations = layers.reduce((sum, layer) => sum + layer.totalOperations, 0);
    const totalHits = layers.reduce((sum, layer) => sum + layer.hits, 0);
    const totalMisses = layers.reduce((sum, layer) => sum + layer.misses, 0);
    const overallHitRatio = totalHits + totalMisses > 0 ? totalHits / (totalHits + totalMisses) : 0;
    const avgResponseTime = layers.length > 0 ? layers.reduce((sum, layer) => sum + layer.avgResponseTime, 0) / layers.length : 0;
    const totalMemoryUsage = layers.reduce((sum, layer) => sum + layer.memoryUsage, 0);
    const mostActiveLayer = layers.reduce(
      (max, layer) => layer.totalOperations > max.totalOperations ? layer : max,
      layers[0] || { layer: "none", totalOperations: 0 }
    );
    const slowestLayer = layers.reduce(
      (max, layer) => layer.avgResponseTime > max.avgResponseTime ? layer : max,
      layers[0] || { layer: "none", avgResponseTime: 0 }
    );
    const recommendations = this.generateRecommendations(layers);
    const report = {
      reportId: `cache-report-${now}`,
      generatedAt: now,
      timeRange: {
        start: startTime,
        end: now,
        durationMs: timeRangeMs
      },
      layers,
      summary: {
        totalOperations,
        overallHitRatio,
        avgResponseTime,
        totalMemoryUsage,
        mostActiveLayer: mostActiveLayer.layer,
        slowestLayer: slowestLayer.layer,
        recommendations
      },
      recentOperations: recentMetrics.slice(-50)
    };
    frontendLogger.adapter.transformSuccess("CacheMonitorBase", {
      message: "Performance report generated",
      reportId: report.reportId,
      totalOperations,
      overallHitRatio: Math.round(overallHitRatio * 100),
      layerCount: layers.length
    });
    return report;
  }
  generateRecommendations(layers) {
    const recommendations = [];
    layers.forEach((layer) => {
      if (layer.hitRatio < this.alertThresholds.hitRatio) {
        recommendations.push(`${layer.layer}: Low hit ratio (${Math.round(layer.hitRatio * 100)}%). Consider increasing TTL or cache size.`);
      }
      if (layer.avgResponseTime > this.alertThresholds.responseTime) {
        recommendations.push(`${layer.layer}: Slow operations (${Math.round(layer.avgResponseTime)}ms avg). Consider optimizing data access patterns.`);
      }
      if (layer.memoryUsage > this.alertThresholds.memoryUsage) {
        recommendations.push(`${layer.layer}: High memory usage (${Math.round(layer.memoryUsage / 1024 / 1024)}MB). Consider implementing cache size limits.`);
      }
    });
    if (recommendations.length === 0) {
      recommendations.push("Cache performance is within acceptable thresholds.");
    }
    return recommendations;
  }
  getAlerts() {
    const layers = Array.from(this.layerStats.values());
    return {
      lowHitRatio: layers.filter((layer) => layer.hitRatio < this.alertThresholds.hitRatio).map((layer) => ({
        layer: layer.layer,
        ratio: layer.hitRatio,
        threshold: this.alertThresholds.hitRatio
      })),
      slowOperations: layers.filter((layer) => layer.avgResponseTime > this.alertThresholds.responseTime).map((layer) => ({
        layer: layer.layer,
        avgTime: layer.avgResponseTime,
        threshold: this.alertThresholds.responseTime
      })),
      highMemoryUsage: layers.filter((layer) => layer.memoryUsage > this.alertThresholds.memoryUsage).map((layer) => ({
        layer: layer.layer,
        usage: layer.memoryUsage,
        threshold: this.alertThresholds.memoryUsage
      })),
      frequentMisses: this.getFrequentMisses()
    };
  }
  getFrequentMisses() {
    const missCount = /* @__PURE__ */ new Map();
    this.metrics.filter((m) => m.operation === "miss").forEach((m) => {
      const key = `${m.layer}:${m.key}`;
      const existing = missCount.get(key);
      if (existing) {
        existing.count++;
      } else {
        missCount.set(key, { count: 1, layer: m.layer });
      }
    });
    return Array.from(missCount.entries()).filter(([_, data]) => data.count >= this.alertThresholds.missFrequency).map(([key, data]) => ({
      key: key.split(":")[1],
      count: data.count,
      layer: data.layer
    })).sort((a, b) => b.count - a.count);
  }
  getRealtimeStats() {
    return {
      layers: Array.from(this.layerStats.values()),
      alerts: this.getAlerts()
    };
  }
  clearMetrics() {
    this.metrics = [];
    this.layerStats.clear();
    frontendLogger.adapter.transformSuccess("CacheMonitorBase", "All metrics cleared");
  }
  getLayerMetrics(layer) {
    return this.metrics.filter((m) => m.layer === layer);
  }
  getScopeMetrics(scopeId) {
    return this.metrics.filter((m) => m.scopeId === scopeId);
  }
};

// src/cache/CacheDebugger.ts
var CacheDebugger = class {
  constructor(eventBus, unifiedCache, cacheMonitor, cacheCoordinator) {
    this.eventBus = eventBus;
    this.unifiedCache = unifiedCache;
    this.cacheMonitor = cacheMonitor;
    this.cacheCoordinator = cacheCoordinator;
    this.debugSessions = /* @__PURE__ */ new Map();
    this.activeSession = null;
    this.operationHistory = [];
    this.maxHistorySize = 1e3;
    this.setupGlobalDebugging();
    frontendLogger.adapter.transformSuccess("CacheDebugger", "Initialized with debugging tools");
  }
  setupGlobalDebugging() {
    if (typeof window !== "undefined" && undefined.DEV) {
      const debugWindow = window;
      debugWindow.cacheDebugger = {
        inspectState: () => this.inspectCacheState(),
        startSession: (filters) => this.startDebugSession(filters),
        stopSession: () => this.stopDebugSession(),
        getPerformanceReport: () => this.cacheMonitor.generateReport(),
        visualizeInvalidation: (dataType) => this.visualizeInvalidationFlow(dataType),
        findBottlenecks: () => this.findPerformanceBottlenecks(),
        analyzeKeyCollisions: () => this.analyzeKeyCollisions(),
        clearAllCaches: () => this.clearAllCaches(),
        help: () => this.showHelp()
      };
      console.log("Cache Debugger loaded. Type `cacheDebugger.help()` for available commands.");
    }
  }
  inspectCacheState() {
    const reportId = `cache-state-${Date.now()}`;
    const timestamp = Date.now();
    const layers = [];
    const unifiedCacheStats = this.unifiedCache.getStats();
    const unifiedCacheKeys = this.extractCacheKeys("UnifiedCache");
    layers.push({
      layer: "UnifiedCache",
      keyCount: unifiedCacheStats.totalEntries,
      memoryUsage: this.estimateMemoryUsage(unifiedCacheKeys),
      oldestEntry: Math.min(...unifiedCacheKeys.map((k) => k.lastAccessed)),
      newestEntry: Math.max(...unifiedCacheKeys.map((k) => k.lastAccessed)),
      keys: unifiedCacheKeys,
      health: this.assessLayerHealth(unifiedCacheKeys),
      issues: this.identifyLayerIssues(unifiedCacheKeys)
    });
    const queryKeys = this.extractQueryCacheKeys();
    layers.push({
      layer: "TanStackQuery",
      keyCount: queryKeys.length,
      memoryUsage: this.estimateMemoryUsage(queryKeys),
      oldestEntry: Math.min(...queryKeys.map((k) => k.lastAccessed)),
      newestEntry: Math.max(...queryKeys.map((k) => k.lastAccessed)),
      keys: queryKeys,
      health: this.assessLayerHealth(queryKeys),
      issues: this.identifyLayerIssues(queryKeys)
    });
    const totalKeys = layers.reduce((sum, layer) => sum + layer.keyCount, 0);
    const totalMemoryUsage = layers.reduce((sum, layer) => sum + layer.memoryUsage, 0);
    const oldestEntry = Math.min(...layers.map((l) => l.oldestEntry));
    const newestEntry = Math.max(...layers.map((l) => l.newestEntry));
    const keyCollisions = this.analyzeKeyCollisions();
    const recommendations = this.generateRecommendations(layers, keyCollisions);
    const report = {
      reportId,
      timestamp,
      layers,
      summary: {
        totalKeys,
        totalMemoryUsage,
        oldestEntry,
        newestEntry,
        layerCount: layers.length
      },
      keyCollisions,
      recommendations
    };
    frontendLogger.adapter.transformSuccess("CacheDebugger", {
      message: "Cache state report generated",
      reportId,
      totalKeys,
      totalMemoryUsage: Math.round(totalMemoryUsage / 1024),
      layerCount: layers.length
    });
    return report;
  }
  startDebugSession(filters = {}) {
    const sessionId = `debug-session-${Date.now()}`;
    const session = {
      sessionId,
      startTime: Date.now(),
      operations: [],
      filters,
      isActive: true
    };
    this.debugSessions.set(sessionId, session);
    this.activeSession = session;
    this.setupSessionEventListeners(session);
    frontendLogger.adapter.transformSuccess("CacheDebugger", {
      message: `Debug session started: ${sessionId}`,
      ...filters
    });
    return sessionId;
  }
  stopDebugSession() {
    if (!this.activeSession) {
      return null;
    }
    this.activeSession.isActive = false;
    const session = this.activeSession;
    this.activeSession = null;
    frontendLogger.adapter.transformSuccess("CacheDebugger", {
      message: `Debug session stopped: ${session.sessionId}`,
      duration: Date.now() - session.startTime,
      operationCount: session.operations.length
    });
    return session;
  }
  setupSessionEventListeners(session) {
    const recordOperation = (operation) => {
      if (!session.isActive) {
        return;
      }
      if (session.filters.layers && !session.filters.layers.includes(operation.layer || "")) {
        return;
      }
      if (session.filters.scopeIds && !session.filters.scopeIds.includes(operation.scopeId || "")) {
        return;
      }
      if (session.filters.dataTypes && !session.filters.dataTypes.includes(operation.dataType || "")) {
        return;
      }
      if (session.filters.operations && !session.filters.operations.includes(operation.operation || "")) {
        return;
      }
      if (session.filters.minDuration && (operation.duration || 0) < session.filters.minDuration) {
        return;
      }
      const debugOp = {
        timestamp: Date.now(),
        layer: operation.layer || "unknown",
        operation: operation.operation || "get",
        key: operation.key || "unknown",
        scopeId: operation.scopeId,
        dataType: operation.dataType,
        duration: operation.duration || 0,
        success: operation.success !== false,
        metadata: operation.metadata
      };
      session.operations.push(debugOp);
      this.operationHistory.push(debugOp);
      if (this.operationHistory.length > this.maxHistorySize) {
        this.operationHistory = this.operationHistory.slice(-this.maxHistorySize);
      }
    };
    this.eventBus.on("cache-updated", (event) => {
      const eventKey = typeof event.metadata?.key === "string" ? event.metadata.key : "unknown";
      recordOperation({
        layer: event.source,
        operation: "set",
        key: eventKey,
        scopeId: event.scopeId,
        dataType: event.dataType,
        duration: 0
      });
    });
    this.eventBus.on("cache-cleared", (event) => {
      const eventPattern = typeof event.metadata?.pattern === "string" ? event.metadata.pattern : "bulk-clear";
      recordOperation({
        layer: event.source,
        operation: "clear",
        key: eventPattern,
        scopeId: event.scopeId,
        dataType: event.dataType,
        duration: 0
      });
    });
  }
  visualizeInvalidationFlow(dataType) {
    const timestamp = Date.now();
    const steps = [
      {
        step: 1,
        layer: "CacheCoordinator",
        operation: "invalidateData",
        startTime: timestamp,
        endTime: timestamp + 10,
        duration: 10,
        success: true,
        keysAffected: [`${dataType}-coordinator`]
      },
      {
        step: 2,
        layer: "UnifiedCache",
        operation: "clearByType",
        startTime: timestamp + 10,
        endTime: timestamp + 25,
        duration: 15,
        success: true,
        keysAffected: [`${dataType}-unified-1`, `${dataType}-unified-2`]
      },
      {
        step: 3,
        layer: "TanStackQuery",
        operation: "invalidateQueries",
        startTime: timestamp + 25,
        endTime: timestamp + 40,
        duration: 15,
        success: true,
        keysAffected: [`${dataType}-query-1`, `${dataType}-query-2`]
      }
    ];
    const diagram = {
      trigger: `${dataType}-invalidation`,
      scopeId: "example-scope",
      timestamp,
      steps,
      duration: 40,
      success: true,
      errors: []
    };
    frontendLogger.adapter.transformSuccess("CacheDebugger", {
      message: `Invalidation flow visualized for ${dataType}`,
      stepCount: steps.length,
      totalDuration: diagram.duration
    });
    return diagram;
  }
  findPerformanceBottlenecks() {
    const slowOperations = this.operationHistory.filter((op) => op.duration > 100).sort((a, b) => b.duration - a.duration).slice(0, 10);
    const missCount = /* @__PURE__ */ new Map();
    this.operationHistory.filter((op) => op.operation === "get" && !op.success).forEach((op) => {
      const count = missCount.get(op.key) || 0;
      missCount.set(op.key, count + 1);
    });
    const frequentMisses = Array.from(missCount.entries()).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    const memoryHogs = [
      { layer: "UnifiedCache", usage: 50 * 1024 * 1024 },
      { layer: "TanStackQuery", usage: 30 * 1024 * 1024 }
    ];
    const recommendations = [
      ...slowOperations.length > 0 ? [`Found ${slowOperations.length} slow operations. Consider optimizing data access patterns.`] : [],
      ...frequentMisses.length > 0 ? [`Found ${frequentMisses.length} frequently missed keys. Consider increasing TTL or preloading.`] : [],
      ...memoryHogs.some((h) => h.usage > 100 * 1024 * 1024) ? ["High memory usage detected. Consider implementing cache size limits."] : []
    ];
    return {
      slowOperations,
      frequentMisses,
      memoryHogs,
      recommendations
    };
  }
  analyzeKeyCollisions() {
    const collisions = [];
    const commonKeys = ["portfolio-summary", "risk-score", "risk-analysis"];
    commonKeys.forEach((key) => {
      collisions.push({
        key,
        layers: ["UnifiedCache", "TanStackQuery"],
        potentialConflict: false,
        recommendation: `Key "${key}" is used across multiple layers but with proper namespacing.`
      });
    });
    return collisions;
  }
  clearAllCaches() {
    try {
      this.unifiedCache.clear();
      this.cacheCoordinator?.clearAll?.();
      frontendLogger.adapter.transformSuccess("CacheDebugger", "All caches cleared");
    } catch (error) {
      frontendLogger.adapter.transformError("CacheDebugger", error, {
        operation: "clear-all-caches"
      });
    }
  }
  showHelp() {
    const help = `
Cache Debugger Commands:

State Inspection:
  cacheDebugger.inspectState()           - Get current cache state report
  cacheDebugger.getPerformanceReport()   - Get performance metrics

Session Debugging:
  cacheDebugger.startSession(filters)    - Start tracking cache operations
  cacheDebugger.stopSession()            - Stop current debug session

Analysis:
  cacheDebugger.findBottlenecks()        - Find performance issues
  cacheDebugger.analyzeKeyCollisions()   - Check for key conflicts
  cacheDebugger.visualizeInvalidation(dataType) - Show invalidation flow

Utilities:
  cacheDebugger.clearAllCaches()         - Clear all caches (use carefully)
  cacheDebugger.help()                   - Show this help

Example filters for startSession():
{
  layers: ['UnifiedCache'],
  scopeIds: ['scope-123'],
  dataTypes: ['riskScore'],
  operations: ['get', 'set'],
  minDuration: 50
}
    `;
    console.log(help);
  }
  extractCacheKeys(_layer) {
    return [
      {
        key: "risk-score-scope-123",
        dataType: "riskScore",
        scopeId: "scope-123",
        size: 1024,
        age: 3e4,
        ttl: 3e5,
        hitCount: 5,
        lastAccessed: Date.now() - 3e4,
        isExpired: false
      }
    ];
  }
  extractQueryCacheKeys() {
    return [
      {
        key: "riskScore-scope-123",
        dataType: "riskScore",
        scopeId: "scope-123",
        size: 2048,
        age: 6e4,
        ttl: 3e5,
        hitCount: 3,
        lastAccessed: Date.now() - 6e4,
        isExpired: false
      }
    ];
  }
  estimateMemoryUsage(keys) {
    return keys.reduce((sum, key) => sum + key.size, 0);
  }
  assessLayerHealth(keys) {
    const expiredCount = keys.filter((k) => k.isExpired).length;
    const expiredRatio = keys.length > 0 ? expiredCount / keys.length : 0;
    if (expiredRatio > 0.5) {
      return "critical";
    }
    if (expiredRatio > 0.2) {
      return "warning";
    }
    return "healthy";
  }
  identifyLayerIssues(keys) {
    const issues = [];
    const expiredCount = keys.filter((k) => k.isExpired).length;
    const lowHitCount = keys.filter((k) => k.hitCount < 2).length;
    if (expiredCount > 0) {
      issues.push(`${expiredCount} expired entries found`);
    }
    if (lowHitCount > keys.length * 0.3) {
      issues.push(`${lowHitCount} entries with low hit count`);
    }
    return issues;
  }
  generateRecommendations(layers, collisions) {
    const recommendations = [];
    layers.forEach((layer) => {
      if (layer.health === "critical") {
        recommendations.push(`${layer.layer}: Critical issues detected. Consider cache cleanup.`);
      }
      if (layer.memoryUsage > 50 * 1024 * 1024) {
        recommendations.push(`${layer.layer}: High memory usage. Consider implementing size limits.`);
      }
    });
    if (collisions.some((c) => c.potentialConflict)) {
      recommendations.push("Key collisions detected. Review cache key naming strategy.");
    }
    return recommendations;
  }
};

// src/cache/types.ts
function generateStandardCacheKey(baseKey, metadata) {
  const keyParts = [
    metadata.dataType,
    metadata.scopeId,
    baseKey,
    metadata.version || "v1"
  ].filter(Boolean);
  return {
    key: keyParts.join("_"),
    metadata: {
      ...metadata,
      timestamp: Date.now()
    }
  };
}
function parseStandardCacheKey(key) {
  const parts = key.split("_");
  if (parts.length < 4) {
    return null;
  }
  return {
    dataType: parts[0],
    scopeId: parts[1],
    baseKey: parts.slice(2, -1).join("_"),
    version: parts[parts.length - 1]
  };
}
function validateCacheKeyMetadata(metadata) {
  return !!(metadata.scopeId && metadata.dataType && typeof metadata.scopeId === "string" && typeof metadata.dataType === "string");
}
function generateContentHash(content) {
  const str = JSON.stringify(content);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash &= hash;
  }
  return Math.abs(hash).toString(36);
}

// src/services/ServiceContainer.ts
var ServiceContainer = class {
  constructor() {
    this.services = /* @__PURE__ */ new Map();
    this.serviceFactories = /* @__PURE__ */ new Map();
  }
  hasService(serviceKey) {
    return this.serviceFactories.has(serviceKey);
  }
  register(serviceKey, serviceFactory, allowOverride = false) {
    if (this.hasService(serviceKey) && !allowOverride) {
      throw new Error(`Service ${serviceKey} is already registered. Use allowOverride=true to replace.`);
    }
    if (allowOverride && this.services.has(serviceKey)) {
      this.services.delete(serviceKey);
    }
    this.serviceFactories.set(serviceKey, serviceFactory);
  }
  safeRegister(serviceKey, serviceFactory) {
    this.register(serviceKey, serviceFactory, true);
  }
  get(serviceKey) {
    if (!this.services.has(serviceKey)) {
      const factory = this.serviceFactories.get(serviceKey);
      if (!factory) {
        throw new Error(`Service ${serviceKey} not registered. Available services: ${Array.from(this.serviceFactories.keys()).join(", ")}`);
      }
      this.services.set(serviceKey, factory());
    }
    return this.services.get(serviceKey);
  }
  unregister(serviceKey) {
    const hadFactory = this.serviceFactories.delete(serviceKey);
    const hadInstance = this.services.delete(serviceKey);
    return hadFactory || hadInstance;
  }
  clear() {
    this.services.clear();
  }
  reset() {
    this.services.clear();
    this.serviceFactories.clear();
  }
  size() {
    return this.serviceFactories.size;
  }
  getRegisteredServices() {
    return Array.from(this.serviceFactories.keys());
  }
};

// src/utils/AdapterRegistry.ts
function hashArgs(args) {
  let seen = /* @__PURE__ */ new WeakSet();
  const validateSerializable = (value, path = "root") => {
    const type = typeof value;
    if (type === "function") {
      throw new Error(`AdapterRegistry keys must be serializable primitives or plain objects. Found function at ${path}`);
    }
    if (type === "symbol") {
      throw new Error(`AdapterRegistry keys must be serializable primitives or plain objects. Found symbol at ${path}`);
    }
    if (value instanceof Map) {
      throw new Error(`AdapterRegistry keys must be serializable primitives or plain objects. Found Map at ${path}`);
    }
    if (value instanceof Set) {
      throw new Error(`AdapterRegistry keys must be serializable primitives or plain objects. Found Set at ${path}`);
    }
    if (value instanceof WeakMap || value instanceof WeakSet) {
      throw new Error(`AdapterRegistry keys must be serializable primitives or plain objects. Found WeakMap/WeakSet at ${path}`);
    }
    if (value instanceof RegExp) {
      throw new Error(`AdapterRegistry keys must be serializable primitives or plain objects. Found RegExp at ${path}`);
    }
    if (type === "object" && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          validateSerializable(item, `${path}[${index}]`);
        });
      } else if (!(value instanceof Date)) {
        const obj = value;
        Object.entries(obj).forEach(([key, val]) => {
          validateSerializable(val, `${path}.${key}`);
        });
      }
    }
  };
  const serialize = (value) => {
    if (value === null) {
      return "null";
    }
    if (value === void 0) {
      return "undefined";
    }
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") {
      return `${type}:${value}`;
    }
    if (type === "object") {
      if (seen.has(value)) {
        return "circular";
      }
      seen.add(value);
      if (Array.isArray(value)) {
        return `array:[${value.map(serialize).join(",")}]`;
      }
      if (value instanceof Date) {
        return `date:${value.toISOString()}`;
      }
      const obj = value;
      const sortedKeys = Object.keys(obj).sort();
      const pairs = sortedKeys.map((key) => `${key}:${serialize(obj[key])}`);
      return `object:{${pairs.join(",")}}`;
    }
    return `${type}:${String(value)}`;
  };
  args.forEach((arg, index) => {
    try {
      validateSerializable(arg, `args[${index}]`);
    } catch (error) {
      throw new Error(`AdapterRegistry validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  seen = /* @__PURE__ */ new WeakSet();
  return args.map(serialize).join("|");
}
var AdapterRegistry = class {
  static getAdapter(type, args, factory, unifiedCache) {
    if (typeof type !== "string" || type.length === 0) {
      throw new Error("AdapterRegistry: type must be a non-empty string");
    }
    const key = `${type}::${hashArgs(args)}`;
    if (!this.instances.has(key)) {
      if (unifiedCache) {
        this.instances.set(key, factory(unifiedCache));
      } else {
        this.instances.set(key, factory());
      }
    }
    return this.instances.get(key);
  }
  static clear() {
    this.instances.clear();
  }
  static delete(type, args) {
    const key = `${type}::${hashArgs(args)}`;
    this.instances.delete(key);
  }
  static size() {
    return this.instances.size;
  }
  static has(type, args) {
    const key = `${type}::${hashArgs(args)}`;
    return this.instances.has(key);
  }
};
AdapterRegistry.instances = /* @__PURE__ */ new Map();

// src/utils/broadcastLogout.ts
var BROADCAST_CHANNEL_NAME = "risk-app";
var LogoutBroadcaster = class {
  constructor() {
    this.channel = null;
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    }
  }
  broadcastLogout() {
    if (this.channel) {
      this.channel.postMessage({ type: "logout", timestamp: Date.now() });
    }
  }
  onLogoutBroadcast(callback) {
    if (!this.channel) {
      return () => {
      };
    }
    const handler = (event) => {
      if (event.data?.type === "logout") {
        callback();
      }
    };
    this.channel.addEventListener("message", handler);
    return () => {
      if (this.channel) {
        this.channel.removeEventListener("message", handler);
      }
    };
  }
  cleanup() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
};
var logoutBroadcaster = new LogoutBroadcaster();
var broadcastLogout = () => logoutBroadcaster.broadcastLogout();

// src/utils/ErrorAdapter.ts
var ErrorAdapter = class {
  static isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  static transformError(error) {
    if (this.isRecord(error) && "success" in error) {
      const maybeCode = error.error_code;
      const maybeMessage = error.message ?? error.error;
      return {
        success: false,
        error_code: typeof maybeCode === "string" ? maybeCode : "UNKNOWN_ERROR",
        message: typeof maybeMessage === "string" ? maybeMessage : "An error occurred",
        details: error.details ?? error
      };
    }
    if (typeof error === "string") {
      return {
        success: false,
        error_code: "STRING_ERROR",
        message: error,
        details: null
      };
    }
    if (error instanceof Error) {
      return {
        success: false,
        error_code: error.name || "ERROR_OBJECT",
        message: error.message,
        details: error.stack
      };
    }
    if (this.isRecord(error) && typeof error.status === "number") {
      const statusText = typeof error.statusText === "string" ? error.statusText : `HTTP Error ${error.status}`;
      return {
        success: false,
        error_code: `HTTP_${error.status}`,
        message: statusText,
        details: error
      };
    }
    return {
      success: false,
      error_code: "UNKNOWN_ERROR",
      message: "An unknown error occurred",
      details: error
    };
  }
  static createSuccess(data) {
    return {
      success: true,
      data
    };
  }
  static isError(response) {
    return this.isRecord(response) && response.success === false;
  }
  static getErrorMessage(error) {
    const envelope = this.transformError(error);
    return envelope.message || "An error occurred";
  }
};

// src/utils/formatting.ts
var LOCALE = "en-US";
var CURRENCY = "USD";
var NO_DATA = "\u2014";
var commonCurrencyFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});
var commonCompactCurrencyFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  notation: "compact",
  compactDisplay: "short",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1
});
var commonNumberFormatter0 = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});
var commonNumberFormatter1 = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});
var commonNumberFormatter2 = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
var commonCompactNumberFormatter = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  compactDisplay: "short",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1
});
var commonCompactNumberFormatter0 = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  compactDisplay: "short",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});
var currencyFormatterCache = /* @__PURE__ */ new Map();
var numberFormatterCache = /* @__PURE__ */ new Map();
var compactFormatterCache = /* @__PURE__ */ new Map();
var normalizeNegativeZero = (value) => Object.is(value, -0) ? 0 : value;
var toFiniteValue = (value) => {
  if (!Number.isFinite(value)) {
    return null;
  }
  return normalizeNegativeZero(value);
};
var normalizeDecimals = (value, fallback) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(20, Math.trunc(value)));
};
var getNumberFormatter = (decimals) => {
  if (decimals === 0) {
    return commonNumberFormatter0;
  }
  if (decimals === 1) {
    return commonNumberFormatter1;
  }
  if (decimals === 2) {
    return commonNumberFormatter2;
  }
  const cached = numberFormatterCache.get(decimals);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  numberFormatterCache.set(decimals, formatter);
  return formatter;
};
var getCurrencyFormatter = (decimals, compact) => {
  if (!compact && decimals === 0) {
    return commonCurrencyFormatter;
  }
  if (compact && decimals === 1) {
    return commonCompactCurrencyFormatter;
  }
  const cacheKey = `${compact ? "compact" : "standard"}:${decimals}`;
  const cached = currencyFormatterCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: CURRENCY,
    notation: compact ? "compact" : "standard",
    compactDisplay: compact ? "short" : void 0,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  currencyFormatterCache.set(cacheKey, formatter);
  return formatter;
};
var getCompactFormatter = (decimals) => {
  if (decimals === 0) {
    return commonCompactNumberFormatter0;
  }
  if (decimals === 1) {
    return commonCompactNumberFormatter;
  }
  const cached = compactFormatterCache.get(decimals);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.NumberFormat(LOCALE, {
    notation: "compact",
    compactDisplay: "short",
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
  compactFormatterCache.set(decimals, formatter);
  return formatter;
};
var withSign = (value, formatted, sign) => {
  if (!sign) {
    return formatted;
  }
  return value >= 0 ? `+${formatted}` : formatted;
};
function formatCurrency(value, opts) {
  const finite = toFiniteValue(value);
  if (finite === null) {
    return NO_DATA;
  }
  const compact = opts?.compact === true;
  const decimals = normalizeDecimals(opts?.decimals, compact ? 1 : 0);
  return getCurrencyFormatter(decimals, compact).format(finite);
}
function formatPercent(value, opts) {
  const finite = toFiniteValue(value);
  if (finite === null) {
    return NO_DATA;
  }
  const decimals = normalizeDecimals(opts?.decimals, 1);
  const formatted = getNumberFormatter(decimals).format(finite);
  return `${withSign(finite, formatted, opts?.sign === true)}%`;
}
function formatNumber(value, opts) {
  const finite = toFiniteValue(value);
  if (finite === null) {
    return NO_DATA;
  }
  const decimals = normalizeDecimals(opts?.decimals, 2);
  const formatted = getNumberFormatter(decimals).format(finite);
  return withSign(finite, formatted, opts?.sign === true);
}
function formatCompact(value, opts) {
  const finite = toFiniteValue(value);
  if (finite === null) {
    return NO_DATA;
  }
  const decimals = normalizeDecimals(opts?.decimals, 1);
  const formatter = getCompactFormatter(decimals);
  const prefix = opts?.prefix ?? "";
  if (!prefix) {
    return formatter.format(finite);
  }
  const absFormatted = formatter.format(Math.abs(finite));
  return finite < 0 ? `-${prefix}${absFormatted}` : `${prefix}${absFormatted}`;
}
function formatBasisPoints(value) {
  const finite = toFiniteValue(value);
  if (finite === null) {
    return NO_DATA;
  }
  const basisPoints = roundTo(finite * 1e4, 0);
  return `${getNumberFormatter(0).format(basisPoints)} bp`;
}
function formatSharpeRatio(value) {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  const finite = value;
  const normalized = Object.is(finite, -0) ? 0 : finite;
  return normalized.toFixed(2);
}
function roundTo(value, decimals = 2) {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }
  const normalized = normalizeNegativeZero(value);
  const safeDecimals = normalizeDecimals(decimals, 2);
  const shifted = Number(`${normalized}e${safeDecimals}`);
  const rounded = Number(`${Math.round(shifted)}e-${safeDecimals}`);
  return normalizeNegativeZero(rounded);
}
function cn(...inputs) {
  return tailwindMerge.twMerge(clsx.clsx(inputs));
}

// src/http/HttpClient.ts
var HttpClient = class {
  constructor(config) {
    this.baseURL = config.baseURL;
    this.getToken = config.getToken;
    this.logger = config.logger;
    this.onUnauthorized = config.onUnauthorized;
  }
  /** JSON request/response */
  async request(endpoint, options = {}) {
    const { config, relativeStart, startTime } = this.createRequestConfig(endpoint, options);
    try {
      const response = await this.fetchWithRetry(`${this.baseURL}${endpoint}`, config, 3);
      const data = await response.json();
      const duration = performance.now() - startTime;
      this.logger?.network.response(endpoint, response.status, duration, "HttpClient");
      if (typeof relativeStart === "number") {
        this.logger?.network.waterfall(endpoint, relativeStart, duration);
      }
      return data;
    } catch (error) {
      this.logger?.network.error(endpoint, this.normalizeError(error), "HttpClient");
      throw error;
    }
  }
  /** Raw Response for SSE streaming */
  async requestStream(endpoint, options = {}) {
    const { config, relativeStart, startTime } = this.createRequestConfig(endpoint, options);
    try {
      const response = await this.fetchWithRetry(`${this.baseURL}${endpoint}`, config, 3);
      const duration = performance.now() - startTime;
      this.logger?.network.response(endpoint, response.status, duration, "HttpClient");
      if (typeof relativeStart === "number") {
        this.logger?.network.waterfall(endpoint, relativeStart, duration);
      }
      return response;
    } catch (error) {
      this.logger?.network.error(endpoint, this.normalizeError(error), "HttpClient");
      throw error;
    }
  }
  /** Retry with exponential backoff (internal) */
  async fetchWithRetry(url, options, retries) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, options);
        if (response.status === 429) {
          throw this.createHttpError(response, "Please wait before refreshing again");
        }
        if (response.ok) {
          return response;
        }
        if (response.status === 401 && this.onUnauthorized) {
          this.onUnauthorized?.();
          throw this.createHttpError(response, "Session expired");
        }
        throw this.createHttpError(response);
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }
        if (this.isRetryableHttpError(error) && error.status === 429) {
          throw error;
        }
        if (this.isRetryableHttpError(error) && error.status === 401 && this.onUnauthorized) {
          throw error;
        }
        if (attempt === retries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1e3 * Math.pow(2, attempt)));
      }
    }
    throw new Error("Max retries exceeded");
  }
  createRequestConfig(endpoint, options) {
    const controller = new AbortController();
    const externalSignal = options.signal;
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener("abort", () => controller.abort(externalSignal.reason), {
          once: true
        });
      }
    }
    const isFormDataBody = typeof FormData !== "undefined" && options.body instanceof FormData;
    const headers = new Headers({
      "X-Requested-With": "XMLHttpRequest"
    });
    if (!isFormDataBody) {
      headers.set("Content-Type", "application/json");
    }
    new Headers(options.headers).forEach((value, key) => {
      if (isFormDataBody && key.toLowerCase() === "content-type") {
        return;
      }
      headers.set(key, value);
    });
    const token = this.getToken?.();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const method = options.method ?? "GET";
    const startTime = performance.now();
    const relativeStart = typeof this.logger?.getNavigationElapsed === "function" ? this.logger.getNavigationElapsed() : void 0;
    this.logger?.network.request(endpoint, method, options.body, "HttpClient");
    return {
      config: {
        ...options,
        signal: controller.signal,
        credentials: "include",
        headers
      },
      relativeStart,
      startTime
    };
  }
  createHttpError(response, message) {
    const error = new Error(
      message ?? `HTTP ${response.status}: ${response.statusText}`
    );
    error.status = response.status;
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10);
      if (!Number.isNaN(parsed)) {
        error.retryAfter = parsed;
      }
    }
    return error;
  }
  isRetryableHttpError(error) {
    return typeof error === "object" && error !== null && "status" in error;
  }
  isAbortError(error) {
    return error instanceof Error && error.name === "AbortError";
  }
  normalizeError(error) {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }
};
var LazyDevtools = React__default.default.lazy(
  () => import('@tanstack/react-query-devtools').then((module) => ({
    default: module.ReactQueryDevtools
  }))
);
var _queryConfig = {
  staleTime: 5 * 60 * 1e3,
  gcTime: 10 * 60 * 1e3
};
var _queryClient = null;
var globalResetFunction = null;
exports.queryClient = void 0;
function createQueryClient() {
  return new reactQuery.QueryClient({
    defaultOptions: {
      queries: {
        staleTime: _queryConfig.staleTime,
        gcTime: _queryConfig.gcTime,
        retry: (failureCount, error) => {
          if (typeof error.status === "number" && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 3;
        },
        refetchOnWindowFocus: false,
        refetchOnMount: true,
        refetchOnReconnect: true
      },
      mutations: {
        retry: false
      }
    }
  });
}
function syncQueryClient(client) {
  _queryClient = client;
  exports.queryClient = client;
  return client;
}
function initQueryConfig(config) {
  _queryConfig = config;
  if (_queryClient) {
    if (globalResetFunction) {
      globalResetFunction();
      return;
    }
    syncQueryClient(createQueryClient());
  }
}
function getQueryClient() {
  if (!_queryClient) {
    return syncQueryClient(createQueryClient());
  }
  return _queryClient;
}
var resetQueryClient = () => {
  if (globalResetFunction) {
    globalResetFunction();
    return;
  }
  syncQueryClient(createQueryClient());
  frontendLogger.warning(
    "QueryClient reset via fallback - component reset function not available",
    "QueryProvider"
  );
};
var _setResetFunction = (resetFn) => {
  globalResetFunction = resetFn;
};
var _clearResetFunction = () => {
  globalResetFunction = null;
};
var QueryProvider = ({ children }) => {
  const [client, setClient] = React.useState(() => getQueryClient());
  const resetClient = React.useCallback(() => {
    const nextClient = syncQueryClient(createQueryClient());
    setClient(nextClient);
  }, []);
  React__default.default.useEffect(() => {
    _setResetFunction(resetClient);
    return () => {
      _clearResetFunction();
    };
  }, [resetClient]);
  return /* @__PURE__ */ jsxRuntime.jsxs(reactQuery.QueryClientProvider, { client, children: [
    children,
    undefined.DEV && /* @__PURE__ */ jsxRuntime.jsx(React__default.default.Suspense, { fallback: null, children: /* @__PURE__ */ jsxRuntime.jsx(LazyDevtools, { initialIsOpen: false }) })
  ] });
};
function createAuthStore(config) {
  let storageHandler = null;
  let broadcastCleanup = null;
  let isListenerSetup = false;
  return traditional.createWithEqualityFn()(
    middleware.devtools((set, get) => ({
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
        config.logger?.logAdapter?.("authStore", "signOut");
        broadcastLogout();
        config.onSignOut?.();
        get().clear();
      },
      // clear() is the raw state reset — clears localStorage + Zustand state.
      // Does NOT call onSignOut (callers do that explicitly to avoid
      // double-invocation when signOut → clear).
      clear: () => {
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem("auth_token");
        }
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          error: null,
          isInitialized: true,
          isLoading: false
        });
      },
      handleCrossTabLogout: () => {
        if (!get().isAuthenticated && get().isInitialized) return;
        config.logger?.logAdapter?.("authStore", "Processing cross-tab logout");
        config.onSignOut?.();
        config.onCrossTabLogout?.();
        get().clear();
      },
      initializeAuth: async () => {
        const state = get();
        if (state.isInitialized) return;
        set({ isLoading: true, error: null });
        try {
          const AUTH_TIMEOUT_MS = 35e3;
          const timeoutPromise = new Promise(
            (_, reject) => setTimeout(() => reject(new Error("Auth check timed out")), AUTH_TIMEOUT_MS)
          );
          const response = await Promise.race([config.checkAuthStatus(), timeoutPromise]);
          if (response.authenticated && response.user) {
            const user = config.mapUser(response.user);
            config.onSignIn?.(user);
            set({ user, isAuthenticated: true, isInitialized: true, isLoading: false, error: null });
          } else {
            config.onUnauthInit?.();
            set({ user: null, isAuthenticated: false, isInitialized: true, isLoading: false, error: null });
          }
        } catch (error) {
          config.logger?.logError?.("authStore", "Auth initialization failed", error);
          set({
            user: null,
            isAuthenticated: false,
            isInitialized: true,
            isLoading: false,
            error: error instanceof Error ? error.message : "Authentication check failed"
          });
        }
      },
      setupCrossTabSync: () => {
        if (typeof window === "undefined" || isListenerSetup) return;
        storageHandler = (e) => {
          if (e.key === "auth_token" && e.newValue === null) {
            get().handleCrossTabLogout();
          }
        };
        broadcastCleanup = logoutBroadcaster.onLogoutBroadcast(() => {
          get().handleCrossTabLogout();
        });
        window.addEventListener("storage", storageHandler);
        isListenerSetup = true;
      },
      teardownCrossTabSync: () => {
        if (typeof window === "undefined" || !isListenerSetup) return;
        if (storageHandler) {
          window.removeEventListener("storage", storageHandler);
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
      isSignedIn: () => get().isAuthenticated && !!get().user
    }), { name: "auth-store" })
  );
}
function createAuthSelectors(useStore) {
  return {
    useUser: () => useStore((s) => s.user),
    useAuthStatus: () => useStore((s) => ({
      isAuthenticated: s.isAuthenticated,
      isLoading: s.isLoading,
      error: s.error
    }), shallow.shallow),
    useAuthActions: () => useStore((s) => ({
      signIn: s.signIn,
      signOut: s.signOut,
      setUser: s.setUser,
      setLoading: s.setLoading,
      setError: s.setError,
      clearError: s.clearError,
      initializeAuth: s.initializeAuth,
      setupCrossTabSync: s.setupCrossTabSync,
      teardownCrossTabSync: s.teardownCrossTabSync
    }), shallow.shallow)
  };
}
function createAuthProvider(useStore) {
  return ({ children }) => {
    const isInitialized = useStore((s) => s.isInitialized);
    const isLoading = useStore((s) => s.isLoading);
    const initializeAuth = useStore((s) => s.initializeAuth);
    const setupCrossTabSync = useStore((s) => s.setupCrossTabSync);
    const teardownCrossTabSync = useStore((s) => s.teardownCrossTabSync);
    React.useEffect(() => {
      setupCrossTabSync();
      return () => teardownCrossTabSync();
    }, [setupCrossTabSync, teardownCrossTabSync]);
    React.useEffect(() => {
      if (!isInitialized && !isLoading) initializeAuth();
    }, [initializeAuth, isInitialized, isLoading]);
    if (!isInitialized) {
      return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "auth-initializing", children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: "loading-spinner", children: "Checking authentication..." }) });
    }
    return /* @__PURE__ */ jsxRuntime.jsx(jsxRuntime.Fragment, { children });
  };
}

// src/config/loadRuntimeConfig.ts
function createRuntimeConfigLoader(options) {
  let cachedConfig = null;
  function loadRuntimeConfig() {
    if (cachedConfig) {
      return cachedConfig;
    }
    try {
      const rawConfig = options.buildRawConfig();
      cachedConfig = options.schema.parse(rawConfig);
      return cachedConfig;
    } catch (error) {
      options.logger?.error?.(
        "Runtime configuration validation failed",
        "loadRuntimeConfig",
        error instanceof Error ? error : new Error(String(error))
      );
      if (undefined.PROD) {
        throw new Error(`Invalid runtime configuration: ${error}`);
      }
      options.logger?.warning?.(
        "Using default configuration due to validation error",
        "loadRuntimeConfig"
      );
      cachedConfig = options.defaults;
      return cachedConfig;
    }
  }
  function clearConfigCache() {
    cachedConfig = null;
  }
  return { loadRuntimeConfig, clearConfigCache };
}

exports.AdapterRegistry = AdapterRegistry;
exports.CacheDebugger = CacheDebugger;
exports.CacheMonitorBase = CacheMonitorBase;
exports.ErrorAdapter = ErrorAdapter;
exports.EventBus = EventBus;
exports.HttpClient = HttpClient;
exports.LogoutBroadcaster = LogoutBroadcaster;
exports.QueryProvider = QueryProvider;
exports.ServiceContainer = ServiceContainer;
exports.UnifiedCache = UnifiedCache;
exports._clearResetFunction = _clearResetFunction;
exports._setResetFunction = _setResetFunction;
exports.broadcastLogout = broadcastLogout;
exports.cn = cn;
exports.createAuthProvider = createAuthProvider;
exports.createAuthSelectors = createAuthSelectors;
exports.createAuthStore = createAuthStore;
exports.createRuntimeConfigLoader = createRuntimeConfigLoader;
exports.default = Logger_default;
exports.formatBasisPoints = formatBasisPoints;
exports.formatCompact = formatCompact;
exports.formatCurrency = formatCurrency;
exports.formatNumber = formatNumber;
exports.formatPercent = formatPercent;
exports.formatSharpeRatio = formatSharpeRatio;
exports.frontendLogger = frontendLogger;
exports.generateContentHash = generateContentHash;
exports.generateStandardCacheKey = generateStandardCacheKey;
exports.getQueryClient = getQueryClient;
exports.initQueryConfig = initQueryConfig;
exports.log = log;
exports.logoutBroadcaster = logoutBroadcaster;
exports.parseStandardCacheKey = parseStandardCacheKey;
exports.resetQueryClient = resetQueryClient;
exports.roundTo = roundTo;
exports.validateCacheKeyMetadata = validateCacheKeyMetadata;
