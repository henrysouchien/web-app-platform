import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import React, { useState, useCallback, useEffect } from 'react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { jsxs, jsx, Fragment } from 'react/jsx-runtime';
import { createWithEqualityFn } from 'zustand/traditional';
import { devtools } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';

// src/logging/Logger.ts
var FrontendLogger = class {
  constructor() {
    this.baseUrl = "";
    this.initialized = false;
    this.isEnabled = import.meta.env.MODE !== "test";
    this.isProduction = import.meta.env.PROD;
    this.sessionId = this.generateSessionId();
    this.logQueue = [];
    this.preInitBuffer = [];
    this.isProcessingQueue = false;
    this.queueFlushTimer = null;
    this.sessionLifecycleStarted = false;
    this.currentUserId = void 0;
    this.sessionStartTime = Date.now();
    this._initTimestamp = null;
    this.SESSION_SUMMARY_INTERVAL_MS = 5 * 60 * 1e3;
    this.QUEUE_FLUSH_DEBOUNCE_MS = 1e3;
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
      this._initTimestamp = Date.now();
      this.sessionStartTime = this._initTimestamp;
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
    if (import.meta.env.DEV) {
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
    if (!import.meta.env.PROD) {
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
    const elapsedSinceInit = this._initTimestamp === null ? Number.POSITIVE_INFINITY : Date.now() - this._initTimestamp;
    const delay = elapsedSinceInit < 2e3 ? Math.max(this.QUEUE_FLUSH_DEBOUNCE_MS, 2e3 - elapsedSinceInit) : this.QUEUE_FLUSH_DEBOUNCE_MS;
    this.queueFlushTimer = setTimeout(() => {
      this.queueFlushTimer = null;
      void this.processQueue();
    }, delay);
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
    const elapsedSinceInit = this._initTimestamp === null ? Number.POSITIVE_INFINITY : Date.now() - this._initTimestamp;
    if (this.logQueue.length < 10 && elapsedSinceInit < 1e4) {
      this.scheduleQueueFlush();
      return;
    }
    this.clearQueueFlushTimer();
    this.isProcessingQueue = true;
    try {
      while (this.logQueue.length > 0) {
        const batch = this.logQueue.splice(0, 50);
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
function estimateSize(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}
function cloneEntry(entry) {
  return { ...entry };
}
var UnifiedCache = class {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.entries = /* @__PURE__ */ new Map();
    this.recentOperations = [];
    this.maxTrackedOperations = 500;
    this.hitCount = 0;
    this.missCount = 0;
  }
  get(key, factory, ttl, metadata) {
    const startedAt = Date.now();
    const existingEntry = this.entries.get(key);
    if (existingEntry && !this.isExpired(existingEntry, startedAt)) {
      existingEntry.hitCount += 1;
      existingEntry.lastAccessedAt = startedAt;
      this.hitCount += 1;
      this.recordOperation({
        key,
        layer: "unified-cache",
        operation: "hit",
        durationMs: Date.now() - startedAt,
        timestamp: startedAt,
        scopeId: existingEntry.scopeId,
        dataType: existingEntry.dataType,
        success: true,
        metadata: { ttl: existingEntry.ttl, size: existingEntry.size }
      });
      this.emitEvent("cache-hit", existingEntry, {
        key,
        ttl: existingEntry.ttl,
        durationMs: Date.now() - startedAt,
        layer: "unified-cache"
      });
      return existingEntry.value;
    }
    if (existingEntry) {
      this.entries.delete(key);
    }
    this.missCount += 1;
    const value = factory();
    const entry = this.buildEntry(key, value, ttl, metadata);
    this.entries.set(key, entry);
    const durationMs = Date.now() - startedAt;
    this.recordOperation({
      key,
      layer: "unified-cache",
      operation: "miss",
      durationMs,
      timestamp: startedAt,
      scopeId: entry.scopeId,
      dataType: entry.dataType,
      success: true,
      metadata: { ttl: entry.ttl, size: entry.size }
    });
    this.emitEvent("cache-miss", entry, {
      key,
      ttl: entry.ttl,
      durationMs,
      layer: "unified-cache"
    });
    this.emitEvent("cache-updated", entry, {
      key,
      ttl: entry.ttl,
      durationMs,
      layer: "unified-cache",
      operation: "set",
      size: entry.size
    });
    return value;
  }
  set(key, value, ttl, metadata) {
    const startedAt = Date.now();
    const entry = this.buildEntry(key, value, ttl, metadata);
    this.entries.set(key, entry);
    const durationMs = Date.now() - startedAt;
    this.recordOperation({
      key,
      layer: "unified-cache",
      operation: "set",
      durationMs,
      timestamp: startedAt,
      scopeId: entry.scopeId,
      dataType: entry.dataType,
      success: true,
      metadata: { ttl: entry.ttl, size: entry.size }
    });
    this.emitEvent("cache-updated", entry, {
      key,
      ttl: entry.ttl,
      durationMs,
      layer: "unified-cache",
      operation: "set",
      size: entry.size
    });
  }
  clearByType(dataType, scopeId) {
    return this.clearMatchingEntries(
      (entry) => entry.dataType === dataType && (!scopeId || entry.scopeId === scopeId),
      {
        dataType,
        scopeId,
        layer: "unified-cache"
      }
    );
  }
  clearScope(scopeId) {
    return this.clearMatchingEntries(
      (entry) => entry.scopeId === scopeId,
      {
        scopeId,
        layer: "unified-cache"
      }
    );
  }
  clear() {
    const cleared = this.entries.size;
    this.entries.clear();
    this.recordOperation({
      key: "*",
      layer: "unified-cache",
      operation: "clear",
      durationMs: 0,
      timestamp: Date.now(),
      success: true,
      metadata: { clearedEntries: cleared }
    });
    this.eventBus.emit("cache-cleared", {
      type: "cache-cleared",
      source: "service",
      timestamp: Date.now(),
      metadata: {
        clearedEntries: cleared,
        layer: "unified-cache",
        operation: "clear"
      }
    });
  }
  clearByPattern(pattern) {
    return this.clearMatchingEntries(
      (entry) => pattern.test(entry.key),
      {
        pattern: pattern.source,
        layer: "unified-cache"
      }
    );
  }
  inspect(key) {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return null;
    }
    return cloneEntry(entry);
  }
  listEntries() {
    this.pruneExpiredEntries();
    return Array.from(this.entries.values()).map((entry) => cloneEntry(entry));
  }
  getStats() {
    const expiredEntries = this.pruneExpiredEntries();
    const entriesByType = {};
    const entriesByScope = {};
    let memoryUsage = 0;
    this.entries.forEach((entry) => {
      const dataType = entry.dataType ?? "unknown";
      const scopeId = entry.scopeId ?? "global";
      entriesByType[dataType] = (entriesByType[dataType] ?? 0) + 1;
      entriesByScope[scopeId] = (entriesByScope[scopeId] ?? 0) + 1;
      memoryUsage += entry.size;
    });
    const totalLookups = this.hitCount + this.missCount;
    return {
      entries: this.entries.size,
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: totalLookups > 0 ? this.hitCount / totalLookups : 0,
      entriesByType,
      entriesByScope,
      expiredEntries,
      memoryUsage,
      totalOperations: this.recentOperations.length
    };
  }
  getPerformanceMetrics(windowMs = 3e5) {
    const cutoff = Date.now() - windowMs;
    const operations = this.recentOperations.filter((operation) => operation.timestamp >= cutoff);
    const hitOperations = operations.filter((operation) => operation.operation === "hit");
    const missOperations = operations.filter((operation) => operation.operation === "miss");
    const writeOperations = operations.filter((operation) => operation.operation === "set");
    const lookupOperations = hitOperations.length + missOperations.length;
    const averageHitTimeMs = hitOperations.length > 0 ? hitOperations.reduce((sum, operation) => sum + operation.durationMs, 0) / hitOperations.length : 0;
    const averageMissTimeMs = missOperations.length > 0 ? missOperations.reduce((sum, operation) => sum + operation.durationMs, 0) / missOperations.length : 0;
    return {
      totalOperations: operations.length,
      hits: hitOperations.length,
      misses: missOperations.length,
      writes: writeOperations.length,
      hitRate: lookupOperations > 0 ? hitOperations.length / lookupOperations : 0,
      averageHitTimeMs,
      averageMissTimeMs,
      recentOperations: operations.slice(-50)
    };
  }
  getRecentOperations(limit = 100) {
    return this.recentOperations.slice(-limit);
  }
  buildEntry(key, value, ttl, metadata) {
    const now = Date.now();
    const normalizedTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : 0;
    return {
      key,
      value,
      ttl: normalizedTtl,
      createdAt: now,
      updatedAt: now,
      expiresAt: normalizedTtl > 0 ? now + normalizedTtl : Number.POSITIVE_INFINITY,
      lastAccessedAt: now,
      hitCount: 0,
      size: estimateSize(value),
      ...metadata
    };
  }
  clearMatchingEntries(predicate, metadata) {
    const removedEntries = [];
    this.entries.forEach((entry) => {
      if (predicate(entry)) {
        removedEntries.push(entry);
        this.entries.delete(entry.key);
      }
    });
    if (removedEntries.length === 0) {
      return 0;
    }
    const scopeId = removedEntries[0]?.scopeId;
    const dataType = removedEntries[0]?.dataType;
    this.recordOperation({
      key: metadata.pattern ? String(metadata.pattern) : `${dataType ?? "*"}:${scopeId ?? "*"}`,
      layer: "unified-cache",
      operation: "invalidate",
      durationMs: 0,
      timestamp: Date.now(),
      scopeId,
      dataType,
      success: true,
      metadata: {
        ...metadata,
        clearedEntries: removedEntries.length
      }
    });
    this.eventBus.emit("cache-invalidated", {
      type: "cache-invalidated",
      source: "service",
      scopeId,
      dataType,
      timestamp: Date.now(),
      metadata: {
        ...metadata,
        clearedEntries: removedEntries.length,
        keys: removedEntries.map((entry) => entry.key),
        operation: "invalidate"
      }
    });
    return removedEntries.length;
  }
  pruneExpiredEntries() {
    const now = Date.now();
    let removed = 0;
    this.entries.forEach((entry) => {
      if (this.isExpired(entry, now)) {
        this.entries.delete(entry.key);
        removed += 1;
      }
    });
    return removed;
  }
  isExpired(entry, now = Date.now()) {
    return Number.isFinite(entry.expiresAt) && entry.expiresAt <= now;
  }
  recordOperation(operation) {
    this.recentOperations.push(operation);
    if (this.recentOperations.length > this.maxTrackedOperations) {
      this.recentOperations.splice(0, this.recentOperations.length - this.maxTrackedOperations);
    }
  }
  emitEvent(eventName, entry, metadata) {
    const eventType = eventName === "cache-updated" ? "data-updated" : eventName === "cache-cleared" ? "cache-cleared" : "cache-invalidated";
    this.eventBus.emit(eventName, {
      type: eventType,
      source: "service",
      scopeId: entry.scopeId,
      dataType: entry.dataType,
      timestamp: Date.now(),
      metadata
    });
  }
};

// src/cache/CacheMonitorBase.ts
var CACHE_EVENT_NAMES = [
  "cache-hit",
  "cache-miss",
  "cache-updated",
  "cache-invalidated",
  "cache-cleared"
];
function toRecord(value) {
  return value && typeof value === "object" ? value : {};
}
var CacheMonitorBase = class {
  constructor(eventBus, config = {}) {
    this.eventBus = eventBus;
    this.recentOperations = [];
    this.unsubscribers = [];
    this.config = {
      eventNames: config.eventNames ?? [],
      maxRecentOperations: config.maxRecentOperations ?? 500,
      slowOperationThresholdMs: config.slowOperationThresholdMs ?? 150,
      hotKeyThreshold: config.hotKeyThreshold ?? 5,
      highMissRateThreshold: config.highMissRateThreshold ?? 0.4
    };
    this.subscribeToEvents();
  }
  trackCacheHit(layer, key, responseTime, dataType, scopeId) {
    this.recordMetric({
      layer,
      key,
      operation: "hit",
      durationMs: responseTime,
      timestamp: Date.now(),
      scopeId,
      dataType,
      success: true
    });
  }
  trackCacheMiss(layer, key, fetchTime, dataType, scopeId) {
    this.recordMetric({
      layer,
      key,
      operation: "miss",
      durationMs: fetchTime,
      timestamp: Date.now(),
      scopeId,
      dataType,
      success: true
    });
  }
  generateReport(timeRangeMs = 3e5) {
    const cutoff = Date.now() - timeRangeMs;
    const operations = this.recentOperations.filter((operation) => operation.timestamp >= cutoff);
    const layers = this.buildLayerPerformance(operations);
    const hits = operations.filter((operation) => operation.operation === "hit").length;
    const misses = operations.filter((operation) => operation.operation === "miss").length;
    const totalLookups = hits + misses;
    return {
      generatedAt: Date.now(),
      timeRangeMs,
      totalOperations: operations.length,
      hitRate: totalLookups > 0 ? hits / totalLookups : 0,
      layers,
      recentOperations: operations.slice(-100),
      alerts: this.buildAlerts(operations, layers)
    };
  }
  getLayerMetrics(layer) {
    return this.recentOperations.filter((operation) => operation.layer === layer);
  }
  getScopeMetrics(scopeId) {
    return this.recentOperations.filter((operation) => operation.scopeId === scopeId);
  }
  getRecentOperations(limit = 100) {
    return this.recentOperations.slice(-limit);
  }
  dispose() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers.length = 0;
  }
  subscribeToEvents() {
    const subscribedEvents = /* @__PURE__ */ new Set([...CACHE_EVENT_NAMES, ...this.config.eventNames]);
    subscribedEvents.forEach((eventName) => {
      const unsubscribe = this.eventBus.on(eventName, (event) => {
        this.recordMetric(this.metricFromEvent(eventName, event));
      });
      this.unsubscribers.push(unsubscribe);
    });
  }
  metricFromEvent(eventName, event) {
    const metadata = toRecord(event.metadata);
    const scopeId = typeof event.scopeId === "string" ? event.scopeId : typeof event.portfolioId === "string" ? event.portfolioId : void 0;
    const key = typeof metadata.key === "string" ? metadata.key : `${eventName}:${event.dataType ?? "unknown"}:${scopeId ?? "global"}`;
    const durationMs = typeof metadata.durationMs === "number" ? metadata.durationMs : 0;
    const layer = typeof metadata.layer === "string" ? metadata.layer : this.resolveLayer(eventName);
    return {
      layer,
      key,
      operation: this.resolveOperation(eventName),
      durationMs,
      timestamp: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
      scopeId,
      dataType: event.dataType,
      success: true,
      metadata
    };
  }
  resolveLayer(eventName) {
    if (eventName.startsWith("cache-")) {
      return "unified-cache";
    }
    if (eventName.includes("risk")) {
      return "risk-coordinator";
    }
    if (eventName.includes("portfolio")) {
      return "portfolio-coordinator";
    }
    return "cache-monitor";
  }
  resolveOperation(eventName) {
    if (eventName === "cache-hit") {
      return "hit";
    }
    if (eventName === "cache-miss") {
      return "miss";
    }
    if (eventName === "cache-updated") {
      return "set";
    }
    if (eventName === "cache-cleared") {
      return "clear";
    }
    return "invalidate";
  }
  recordMetric(metric) {
    this.recentOperations.push(metric);
    if (this.recentOperations.length > this.config.maxRecentOperations) {
      this.recentOperations.splice(0, this.recentOperations.length - this.config.maxRecentOperations);
    }
  }
  buildLayerPerformance(operations) {
    const byLayer = /* @__PURE__ */ new Map();
    operations.forEach((operation) => {
      const layerOperations = byLayer.get(operation.layer) ?? [];
      layerOperations.push(operation);
      byLayer.set(operation.layer, layerOperations);
    });
    return Array.from(byLayer.entries()).map(([layer, layerOperations]) => {
      const hits = layerOperations.filter((operation) => operation.operation === "hit").length;
      const misses = layerOperations.filter((operation) => operation.operation === "miss").length;
      const totalLookups = hits + misses;
      const totalDuration = layerOperations.reduce((sum, operation) => sum + operation.durationMs, 0);
      return {
        layer,
        operations: layerOperations.length,
        hits,
        misses,
        hitRate: totalLookups > 0 ? hits / totalLookups : 0,
        averageResponseTime: layerOperations.length > 0 ? totalDuration / layerOperations.length : 0,
        slowOperations: layerOperations.filter(
          (operation) => operation.durationMs >= this.config.slowOperationThresholdMs
        ).length
      };
    });
  }
  buildAlerts(operations, layers) {
    const keyCounts = /* @__PURE__ */ new Map();
    const missCounts = /* @__PURE__ */ new Map();
    operations.forEach((operation) => {
      keyCounts.set(operation.key, (keyCounts.get(operation.key) ?? 0) + 1);
      if (operation.operation === "hit" || operation.operation === "miss") {
        const counts = missCounts.get(operation.layer) ?? { misses: 0, totalLookups: 0 };
        counts.totalLookups += 1;
        if (operation.operation === "miss") {
          counts.misses += 1;
        }
        missCounts.set(operation.layer, counts);
      }
    });
    return {
      slowLayers: layers.filter((layer) => layer.slowOperations > 0).map((layer) => layer.layer),
      hotKeys: Array.from(keyCounts.entries()).filter(([, count]) => count >= this.config.hotKeyThreshold).map(([key]) => key),
      highMissRateLayers: Array.from(missCounts.entries()).filter(([, counts]) => counts.totalLookups > 0 && counts.misses / counts.totalLookups >= this.config.highMissRateThreshold).map(([layer]) => layer)
    };
  }
};

// src/cache/CacheDebugger.ts
var DEBUG_EVENT_NAMES = [
  "cache-hit",
  "cache-miss",
  "cache-updated",
  "cache-invalidated",
  "cache-cleared",
  "risk-data-invalidated",
  "portfolio-data-invalidated",
  "user-data-invalidated"
];
function normalizeKeyInfo(entry) {
  const now = Date.now();
  const remainingTtlMs = Number.isFinite(entry.expiresAt) ? Math.max(entry.expiresAt - now, 0) : null;
  return {
    key: entry.key,
    dataType: entry.dataType,
    scopeId: entry.scopeId,
    ttl: entry.ttl,
    expiresAt: entry.expiresAt,
    ageMs: now - entry.createdAt,
    remainingTtlMs,
    hitCount: entry.hitCount,
    size: entry.size,
    isExpired: remainingTtlMs === 0 && Number.isFinite(entry.expiresAt)
  };
}
var CacheDebugger = class {
  constructor(eventBus, unifiedCache, cacheMonitor, cacheCoordinator) {
    this.eventBus = eventBus;
    this.unifiedCache = unifiedCache;
    this.cacheMonitor = cacheMonitor;
    this.cacheCoordinator = cacheCoordinator;
    this.activeSession = null;
    this.unsubscribeSessionEvents = [];
  }
  inspectCacheState() {
    const entries = this.unifiedCache.listEntries();
    const groupedLayers = /* @__PURE__ */ new Map();
    entries.forEach((entry) => {
      const layer = entry.dataType ?? "unknown";
      const layerEntries = groupedLayers.get(layer) ?? [];
      layerEntries.push(normalizeKeyInfo(entry));
      groupedLayers.set(layer, layerEntries);
    });
    const layers = Array.from(groupedLayers.entries()).map(([layer, keys]) => ({
      layer,
      entryCount: keys.length,
      memoryUsage: keys.reduce((sum, key) => sum + key.size, 0),
      keys
    }));
    return {
      generatedAt: Date.now(),
      totalEntries: entries.length,
      totalMemoryUsage: layers.reduce((sum, layer) => sum + layer.memoryUsage, 0),
      stats: this.unifiedCache.getStats(),
      layers,
      activeDebugSession: this.activeSession ? {
        ...this.activeSession,
        operations: [...this.activeSession.operations],
        filters: { ...this.activeSession.filters }
      } : null
    };
  }
  startDebugSession(filters = {}) {
    if (this.activeSession) {
      this.stopDebugSession();
    }
    const sessionId = `debug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.activeSession = {
      id: sessionId,
      startedAt: Date.now(),
      filters: { ...filters },
      operations: []
    };
    this.unsubscribeSessionEvents = DEBUG_EVENT_NAMES.map((eventName) => this.eventBus.on(eventName, (event) => {
      if (!this.activeSession) {
        return;
      }
      const operation = this.toDebugOperation(eventName, event);
      if (this.matchesFilters(operation, this.activeSession.filters)) {
        this.activeSession.operations.push(operation);
      }
    }));
    return sessionId;
  }
  stopDebugSession() {
    if (!this.activeSession) {
      return null;
    }
    this.unsubscribeSessionEvents.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeSessionEvents = [];
    const completedSession = {
      ...this.activeSession,
      endedAt: Date.now(),
      operations: [...this.activeSession.operations],
      filters: { ...this.activeSession.filters }
    };
    this.activeSession = null;
    return completedSession;
  }
  visualizeInvalidationFlow(dataType) {
    const recentOperations = this.cacheMonitor.generateReport(36e5).recentOperations.filter((operation) => operation.dataType === dataType).filter((operation) => operation.operation === "invalidate" || operation.operation === "clear");
    const scopeId = recentOperations[0]?.scopeId ?? "global";
    const steps = recentOperations.length > 0 ? recentOperations.map((operation) => ({
      timestamp: operation.timestamp,
      event: operation.operation,
      description: `${operation.layer} ${operation.operation} on ${operation.key}`,
      scopeId: operation.scopeId
    })) : [{
      timestamp: Date.now(),
      event: "none",
      description: `No invalidation activity recorded for ${dataType}`,
      scopeId
    }];
    return {
      dataType,
      scopeId,
      steps
    };
  }
  findPerformanceBottlenecks() {
    const report = this.cacheMonitor.generateReport(36e5);
    const slowOperations = report.recentOperations.filter((operation) => operation.durationMs >= 150);
    const missCounts = /* @__PURE__ */ new Map();
    report.recentOperations.filter((operation) => operation.operation === "miss").forEach((operation) => {
      missCounts.set(operation.key, (missCounts.get(operation.key) ?? 0) + 1);
    });
    const frequentMisses = Array.from(missCounts.entries()).sort((left, right) => right[1] - left[1]).slice(0, 10).map(([key, count]) => ({ key, count }));
    const memoryHogs = this.inspectCacheState().layers.map((layer) => ({ layer: layer.layer, usage: layer.memoryUsage })).sort((left, right) => right.usage - left.usage).slice(0, 5);
    const recommendations = [];
    if (report.alerts.highMissRateLayers.length > 0) {
      recommendations.push(`Review miss-heavy layers: ${report.alerts.highMissRateLayers.join(", ")}`);
    }
    if (slowOperations.length > 0) {
      recommendations.push("Reduce expensive cache population paths or increase warm-up coverage.");
    }
    if (memoryHogs.length > 0 && memoryHogs[0].usage > 25e4) {
      recommendations.push(`Trim oversized cache layer ${memoryHogs[0].layer} or reduce TTLs.`);
    }
    if (recommendations.length === 0) {
      recommendations.push("No obvious cache bottlenecks detected in the current sample window.");
    }
    return {
      slowOperations,
      frequentMisses,
      memoryHogs,
      recommendations
    };
  }
  clearAll() {
    this.cacheCoordinator.clearAll?.();
  }
  toDebugOperation(eventName, event) {
    const metadata = event.metadata ?? {};
    const scopeId = typeof event.scopeId === "string" ? event.scopeId : typeof event.portfolioId === "string" ? event.portfolioId : void 0;
    return {
      layer: typeof metadata.layer === "string" ? metadata.layer : "debug-session",
      key: typeof metadata.key === "string" ? metadata.key : `${eventName}:${event.dataType ?? "unknown"}`,
      operation: eventName === "cache-hit" ? "hit" : eventName === "cache-miss" ? "miss" : eventName === "cache-updated" ? "set" : eventName === "cache-cleared" ? "clear" : "invalidate",
      durationMs: typeof metadata.durationMs === "number" ? metadata.durationMs : 0,
      timestamp: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
      scopeId,
      dataType: event.dataType,
      success: true,
      metadata
    };
  }
  matchesFilters(operation, filters) {
    if (filters.layer && operation.layer !== filters.layer) {
      return false;
    }
    if (filters.scopeIds && filters.scopeIds.length > 0 && !filters.scopeIds.includes(operation.scopeId ?? "")) {
      return false;
    }
    if (filters.dataTypes && filters.dataTypes.length > 0 && !filters.dataTypes.includes(operation.dataType ?? "")) {
      return false;
    }
    if (filters.operations && filters.operations.length > 0 && !filters.operations.includes(operation.operation)) {
      return false;
    }
    if (filters.since && operation.timestamp < filters.since) {
      return false;
    }
    return true;
  }
};

// src/cache/types.ts
var CACHE_KEY_PREFIX = "cache";
function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.keys(value).sort().reduce((accumulator, key) => {
      accumulator[key] = sortValue(value[key]);
      return accumulator;
    }, {});
  }
  return value;
}
function deterministicStringify(value) {
  return JSON.stringify(sortValue(value));
}
function generateContentHash(value) {
  const serialized = deterministicStringify(value);
  let hash = 0;
  for (let index = 0; index < serialized.length; index += 1) {
    hash = (hash << 5) - hash + serialized.charCodeAt(index);
    hash |= 0;
  }
  return `${Math.abs(hash).toString(36)}${serialized.length.toString(36)}`;
}
function validateCacheKeyMetadata(metadata) {
  return metadata && typeof metadata.scopeId === "string" && metadata.scopeId.length > 0 && typeof metadata.dataType === "string" && metadata.dataType.length > 0 && typeof metadata.version === "string" && metadata.version.length > 0 && typeof metadata.timestamp === "number";
}
function generateStandardCacheKey(baseKey, metadata) {
  const normalizedMetadata = {
    ...metadata,
    version: metadata.version ?? "v1",
    timestamp: metadata.timestamp ?? Date.now()
  };
  if (!validateCacheKeyMetadata(normalizedMetadata)) {
    throw new Error("Cache key metadata must include non-empty scopeId and dataType values");
  }
  const key = [
    CACHE_KEY_PREFIX,
    normalizedMetadata.version,
    encodeURIComponent(normalizedMetadata.dataType),
    encodeURIComponent(normalizedMetadata.scopeId),
    encodeURIComponent(baseKey)
  ].join("::");
  return {
    key,
    metadata: normalizedMetadata
  };
}
function parseStandardCacheKey(key) {
  const parts = key.split("::");
  if (parts.length !== 5 || parts[0] !== CACHE_KEY_PREFIX) {
    return null;
  }
  try {
    return {
      version: parts[1],
      dataType: decodeURIComponent(parts[2]),
      scopeId: decodeURIComponent(parts[3]),
      baseKey: decodeURIComponent(parts[4])
    };
  } catch {
    return null;
  }
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
  return twMerge(clsx(inputs));
}

// src/errors/UpgradeRequiredError.ts
var UpgradeRequiredError = class extends Error {
  constructor(tierRequired, tierCurrent, message) {
    super(message ?? `This feature requires a ${tierRequired} subscription.`);
    this.status = 403;
    this.name = "UpgradeRequiredError";
    this.tierRequired = tierRequired;
    this.tierCurrent = tierCurrent;
    Object.setPrototypeOf(this, new.target.prototype);
  }
};

// src/http/HttpClient.ts
var HttpClient = class {
  constructor(config) {
    this.baseURL = config.baseURL;
    this.getToken = config.getToken;
    this.logger = config.logger;
    this.onUnauthorized = config.onUnauthorized;
    this.onAuthRetry = config.onAuthRetry;
  }
  /** JSON request/response */
  async request(endpoint, options = {}) {
    const { config, relativeStart, startTime, retries } = this.createRequestConfig(endpoint, options);
    try {
      const response = await this.fetchWithRetry(`${this.baseURL}${endpoint}`, config, retries);
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
    const { config, relativeStart, startTime, retries } = this.createRequestConfig(endpoint, options);
    try {
      const response = await this.fetchWithRetry(`${this.baseURL}${endpoint}`, config, retries);
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
    let authRetried = false;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, options);
        if (response.status === 429) {
          throw this.createHttpError(response, "Please wait before refreshing again");
        }
        if (response.ok) {
          return response;
        }
        if (response.status === 401) {
          if (this.onAuthRetry && !authRetried) {
            authRetried = true;
            const stillValid = await this.onAuthRetry().catch(() => false);
            if (stillValid) {
              continue;
            }
          }
          this.onUnauthorized?.();
          throw this.createHttpError(response, "Session expired");
        }
        if (response.status === 403) {
          const upgradeRequiredError = await this.createUpgradeRequiredError(response);
          if (upgradeRequiredError) {
            throw upgradeRequiredError;
          }
        }
        throw this.createHttpError(response);
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }
        if (this.isRetryableHttpError(error) && error.status === 429) {
          throw error;
        }
        if (this.isRetryableHttpError(error) && (error.status === 401 || error.status === 403)) {
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
    const { retry, ...requestOptions } = options;
    const controller = new AbortController();
    const externalSignal = requestOptions.signal;
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener("abort", () => controller.abort(externalSignal.reason), {
          once: true
        });
      }
    }
    const isFormDataBody = typeof FormData !== "undefined" && requestOptions.body instanceof FormData;
    const headers = new Headers({
      "X-Requested-With": "XMLHttpRequest"
    });
    if (!isFormDataBody) {
      headers.set("Content-Type", "application/json");
    }
    new Headers(requestOptions.headers).forEach((value, key) => {
      if (isFormDataBody && key.toLowerCase() === "content-type") {
        return;
      }
      headers.set(key, value);
    });
    const token = this.getToken?.();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const method = requestOptions.method ?? "GET";
    const startTime = performance.now();
    const relativeStart = typeof this.logger?.getNavigationElapsed === "function" ? this.logger.getNavigationElapsed() : void 0;
    this.logger?.network.request(endpoint, method, requestOptions.body, "HttpClient");
    return {
      config: {
        ...requestOptions,
        signal: controller.signal,
        credentials: "include",
        headers
      },
      retries: retry === false ? 0 : typeof retry === "number" ? Math.max(0, retry) : 3,
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
  async createUpgradeRequiredError(response) {
    const body = await response.clone().json().catch(() => null);
    if (body?.detail?.error !== "upgrade_required") {
      return null;
    }
    const tierRequired = typeof body.detail.tier_required === "string" ? body.detail.tier_required : "paid";
    const tierCurrent = typeof body.detail.tier_current === "string" ? body.detail.tier_current : "registered";
    const message = typeof body.detail.message === "string" ? body.detail.message : void 0;
    return new UpgradeRequiredError(tierRequired, tierCurrent, message);
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
var LazyDevtools = React.lazy(
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
var queryClient;
function createQueryClient() {
  return new QueryClient({
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
  queryClient = client;
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
  return /* @__PURE__ */ jsxs(QueryClientProvider, { client, children: [
    children,
    import.meta.env.DEV && /* @__PURE__ */ jsx(React.Suspense, { fallback: null, children: /* @__PURE__ */ jsx(LazyDevtools, { initialIsOpen: false }) })
  ] });
};
function createAuthStore(config) {
  let storageHandler = null;
  let broadcastCleanup = null;
  let isListenerSetup = false;
  let initializePromise = null;
  return createWithEqualityFn()(
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
        if (initializePromise) return initializePromise;
        initializePromise = (async () => {
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
          } finally {
            initializePromise = null;
          }
        })();
        return initializePromise;
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
      teardownCrossTabSync: s.teardownCrossTabSync
    }), shallow)
  };
}
function createAuthProvider(useStore) {
  return ({ children }) => {
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
      return /* @__PURE__ */ jsx("div", { className: "auth-initializing", children: /* @__PURE__ */ jsx("div", { className: "loading-spinner", children: "Checking authentication..." }) });
    }
    return /* @__PURE__ */ jsx(Fragment, { children });
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
      if (import.meta.env.PROD) {
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

export { AdapterRegistry, CacheDebugger, CacheMonitorBase, ErrorAdapter, EventBus, HttpClient, LogoutBroadcaster, QueryProvider, ServiceContainer, UnifiedCache, UpgradeRequiredError, _clearResetFunction, _setResetFunction, broadcastLogout, cn, createAuthProvider, createAuthSelectors, createAuthStore, createRuntimeConfigLoader, Logger_default as default, formatBasisPoints, formatCompact, formatCurrency, formatNumber, formatPercent, formatSharpeRatio, frontendLogger, generateContentHash, generateStandardCacheKey, getQueryClient, initQueryConfig, log, logoutBroadcaster, parseStandardCacheKey, queryClient, resetQueryClient, roundTo, validateCacheKeyMetadata };
