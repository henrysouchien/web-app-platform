import type { CacheEvent } from '../events/EventBus';
import { EventBus } from '../events/EventBus';
import { frontendLogger } from '../logging/Logger';

export interface CacheEntry<T = unknown> {
  value: T;
  timestamp: number;
  ttl: number;
  scopeId?: string;
  dataType?: string;
}

export interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRatio: number;
  entriesByType: Record<string, number>;
  entriesByScope: Record<string, number>;
}

export interface CachePerformanceMetrics {
  hitRatio: number;
  avgResponseTime: number;
  totalRequests: number;
  errorRate: number;
  entriesByType: Record<string, { hits: number; misses: number; errors: number }>;
  recentOperations: Array<{
    timestamp: number;
    operation: 'hit' | 'miss' | 'clear' | 'error';
    key: string;
    responseTime?: number;
    dataType?: string;
  }>;
}

export class UnifiedCache {
  private cache = new Map<string, CacheEntry>();
  private performanceMetrics = {
    totalRequests: 0,
    totalHits: 0,
    totalMisses: 0,
    totalErrors: 0,
    responseTimes: [] as number[],
    operationLog: [] as CachePerformanceMetrics['recentOperations'],
    typeMetrics: new Map<string, { hits: number; misses: number; errors: number }>(),
  };

  constructor(private eventBus: EventBus) {}

  get<T>(
    key: string,
    factory: () => T,
    ttl: number,
    metadata?: { scopeId?: string; dataType?: string },
  ): T {
    const startTime = performance.now();
    this.performanceMetrics.totalRequests++;

    try {
      const entry = this.cache.get(key);
      const now = Date.now();

      if (entry && now - entry.timestamp < entry.ttl) {
        const responseTime = performance.now() - startTime;
        this.recordOperation('hit', key, responseTime, metadata?.dataType);
        frontendLogger.adapter.transformSuccess('UnifiedCache', `Cache hit: ${key}`);
        return entry.value as T;
      }

      frontendLogger.adapter.transformStart('UnifiedCache', `Cache miss: ${key}`);
      const value = factory();
      const responseTime = performance.now() - startTime;
      this.recordOperation('miss', key, responseTime, metadata?.dataType);

      const cacheEntry: CacheEntry<T> = {
        value,
        timestamp: now,
        ttl,
        scopeId: metadata?.scopeId,
        dataType: metadata?.dataType,
      };

      this.cache.set(key, cacheEntry);

      try {
        this.eventBus.emit<CacheEvent>('cache-updated', {
          type: 'data-updated',
          source: 'adapter',
          scopeId: metadata?.scopeId,
          dataType: metadata?.dataType,
          timestamp: now,
          metadata: { key, ttl },
        });
      } catch (error) {
        frontendLogger.adapter.transformError('UnifiedCache', error as Error, {
          operation: 'emit-cache-updated',
          key,
        });
      }

      frontendLogger.adapter.transformSuccess('UnifiedCache', `Cached: ${key}`);
      return value;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.recordOperation('error', key, responseTime, metadata?.dataType);
      frontendLogger.adapter.transformError('UnifiedCache', error as Error, { key, metadata });
      throw error;
    }
  }

  set<T>(key: string, value: T, ttl: number, metadata?: { scopeId?: string; dataType?: string }): void {
    const now = Date.now();
    const cacheEntry: CacheEntry<T> = {
      value,
      timestamp: now,
      ttl,
      scopeId: metadata?.scopeId,
      dataType: metadata?.dataType,
    };

    this.cache.set(key, cacheEntry);

    try {
      this.eventBus.emit<CacheEvent>('cache-updated', {
        type: 'data-updated',
        source: 'adapter',
        scopeId: metadata?.scopeId,
        dataType: metadata?.dataType,
        timestamp: now,
        metadata: { key, ttl },
      });
    } catch (error) {
      frontendLogger.adapter.transformError('UnifiedCache', error as Error, {
        operation: 'emit-cache-updated',
        key,
      });
    }

    frontendLogger.adapter.transformSuccess('UnifiedCache', `Set cache entry: ${key}`);
  }

  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      frontendLogger.adapter.transformSuccess('UnifiedCache', `Deleted cache entry: ${key}`);
    }
    return deleted;
  }

  clearByType(dataType: string, scopeId?: string): number {
    let clearedCount = 0;
    const keysToDelete: string[] = [];

    for (const [key, entry] of Array.from(this.cache.entries())) {
      const matchesType = entry.dataType === dataType;
      const matchesScope = !scopeId || entry.scopeId === scopeId;

      if (matchesType && matchesScope) {
        keysToDelete.push(key);
        clearedCount++;
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));

    if (clearedCount > 0) {
      frontendLogger.adapter.transformSuccess(
        'UnifiedCache',
        `Cleared ${clearedCount} entries for type: ${dataType}${scopeId ? `, scope: ${scopeId}` : ''}`,
      );

      this.eventBus.emit<CacheEvent>('cache-cleared', {
        type: 'cache-cleared',
        source: 'adapter',
        scopeId,
        dataType,
        timestamp: Date.now(),
        metadata: { clearedCount },
      });
    }

    return clearedCount;
  }

  clearByPattern(pattern: RegExp): number {
    let clearedCount = 0;
    const keysToDelete: string[] = [];

    for (const key of Array.from(this.cache.keys())) {
      if (pattern.test(key)) {
        keysToDelete.push(key);
        clearedCount++;
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));

    if (clearedCount > 0) {
      frontendLogger.adapter.transformSuccess(
        'UnifiedCache',
        `Cleared ${clearedCount} entries matching pattern: ${pattern}`,
      );

      this.eventBus.emit<CacheEvent>('cache-cleared', {
        type: 'cache-cleared',
        source: 'adapter',
        timestamp: Date.now(),
        metadata: { clearedCount, pattern: pattern.toString() },
      });
    }

    return clearedCount;
  }

  clearScope(scopeId: string): number {
    let clearedCount = 0;
    const keysToDelete: string[] = [];

    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (entry.scopeId === scopeId) {
        keysToDelete.push(key);
        clearedCount++;
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));

    if (clearedCount > 0) {
      frontendLogger.adapter.transformSuccess('UnifiedCache', `Cleared ${clearedCount} entries for scope: ${scopeId}`);

      this.eventBus.emit<CacheEvent>('cache-cleared', {
        type: 'cache-cleared',
        source: 'adapter',
        scopeId,
        timestamp: Date.now(),
        metadata: { clearedCount },
      });
    }

    return clearedCount;
  }

  clear(): void {
    const clearedCount = this.cache.size;
    this.cache.clear();

    frontendLogger.adapter.transformSuccess('UnifiedCache', `Cleared all cache entries (${clearedCount} total)`);

    this.eventBus.emit<CacheEvent>('cache-cleared', {
      type: 'cache-cleared',
      source: 'adapter',
      timestamp: Date.now(),
      metadata: { clearedCount },
    });
  }

  has(key: string): boolean {
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

  inspect(key: string): CacheEntry | null {
    return this.cache.get(key) || null;
  }

  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  private recordOperation(
    operation: 'hit' | 'miss' | 'clear' | 'error',
    key: string,
    responseTime: number,
    dataType?: string,
  ): void {
    if (operation === 'hit') {
      this.performanceMetrics.totalHits++;
    }
    if (operation === 'miss') {
      this.performanceMetrics.totalMisses++;
    }
    if (operation === 'error') {
      this.performanceMetrics.totalErrors++;
    }

    this.performanceMetrics.responseTimes.push(responseTime);
    if (this.performanceMetrics.responseTimes.length > 1000) {
      this.performanceMetrics.responseTimes.shift();
    }

    if (dataType) {
      if (!this.performanceMetrics.typeMetrics.has(dataType)) {
        this.performanceMetrics.typeMetrics.set(dataType, { hits: 0, misses: 0, errors: 0 });
      }
      const typeStats = this.performanceMetrics.typeMetrics.get(dataType)!;
      if (operation === 'hit') {
        typeStats.hits++;
      } else if (operation === 'miss') {
        typeStats.misses++;
      } else if (operation === 'error') {
        typeStats.errors++;
      }
    }

    this.performanceMetrics.operationLog.push({
      timestamp: Date.now(),
      operation,
      key,
      responseTime,
      dataType,
    });

    if (this.performanceMetrics.operationLog.length > 100) {
      this.performanceMetrics.operationLog.shift();
    }
  }

  getStats(): CacheStats {
    const entriesByType: Record<string, number> = {};
    const entriesByScope: Record<string, number> = {};

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
      entriesByScope,
    };
  }

  getPerformanceMetrics(): CachePerformanceMetrics {
    const totalRequests = this.performanceMetrics.totalRequests;
    const avgResponseTime = this.performanceMetrics.responseTimes.length > 0
      ? this.performanceMetrics.responseTimes.reduce((a, b) => a + b, 0) / this.performanceMetrics.responseTimes.length
      : 0;

    return {
      hitRatio: totalRequests > 0 ? this.performanceMetrics.totalHits / totalRequests : 0,
      avgResponseTime,
      totalRequests,
      errorRate: totalRequests > 0 ? this.performanceMetrics.totalErrors / totalRequests : 0,
      entriesByType: Object.fromEntries(this.performanceMetrics.typeMetrics),
      recentOperations: [...this.performanceMetrics.operationLog],
    };
  }
}
