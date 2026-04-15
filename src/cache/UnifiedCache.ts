import type { EventBus } from '../events/EventBus';
import type { CacheEntryMetadata, CacheOperationMetrics } from './types';

export interface CacheEntry<T = unknown> extends CacheEntryMetadata {
  key: string;
  value: T;
  ttl: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  hitCount: number;
  size: number;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
  entriesByType: Record<string, number>;
  entriesByScope: Record<string, number>;
  expiredEntries: number;
  memoryUsage: number;
  totalOperations: number;
}

export interface CachePerformanceMetrics {
  totalOperations: number;
  hits: number;
  misses: number;
  writes: number;
  hitRate: number;
  averageHitTimeMs: number;
  averageMissTimeMs: number;
  recentOperations: CacheOperationMetrics[];
}

type CacheEventType = 'cache-hit' | 'cache-miss' | 'cache-updated' | 'cache-invalidated' | 'cache-cleared';

function estimateSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function cloneEntry<T>(entry: CacheEntry<T>): CacheEntry<T> {
  return { ...entry };
}

export class UnifiedCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly recentOperations: CacheOperationMetrics[] = [];
  private readonly maxTrackedOperations = 500;
  private hitCount = 0;
  private missCount = 0;

  constructor(private readonly eventBus: EventBus) {}

  get<T>(
    key: string,
    factory: () => T,
    ttl: number,
    metadata?: CacheEntryMetadata,
  ): T {
    const startedAt = Date.now();
    const existingEntry = this.entries.get(key) as CacheEntry<T> | undefined;

    if (existingEntry && !this.isExpired(existingEntry, startedAt)) {
      existingEntry.hitCount += 1;
      existingEntry.lastAccessedAt = startedAt;
      this.hitCount += 1;

      this.recordOperation({
        key,
        layer: 'unified-cache',
        operation: 'hit',
        durationMs: Date.now() - startedAt,
        timestamp: startedAt,
        scopeId: existingEntry.scopeId,
        dataType: existingEntry.dataType,
        success: true,
        metadata: { ttl: existingEntry.ttl, size: existingEntry.size },
      });

      this.emitEvent('cache-hit', existingEntry, {
        key,
        ttl: existingEntry.ttl,
        durationMs: Date.now() - startedAt,
        layer: 'unified-cache',
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
      layer: 'unified-cache',
      operation: 'miss',
      durationMs,
      timestamp: startedAt,
      scopeId: entry.scopeId,
      dataType: entry.dataType,
      success: true,
      metadata: { ttl: entry.ttl, size: entry.size },
    });

    this.emitEvent('cache-miss', entry, {
      key,
      ttl: entry.ttl,
      durationMs,
      layer: 'unified-cache',
    });

    this.emitEvent('cache-updated', entry, {
      key,
      ttl: entry.ttl,
      durationMs,
      layer: 'unified-cache',
      operation: 'set',
      size: entry.size,
    });

    return value;
  }

  set<T>(key: string, value: T, ttl: number, metadata?: CacheEntryMetadata): void {
    const startedAt = Date.now();
    const entry = this.buildEntry(key, value, ttl, metadata);
    this.entries.set(key, entry);

    const durationMs = Date.now() - startedAt;
    this.recordOperation({
      key,
      layer: 'unified-cache',
      operation: 'set',
      durationMs,
      timestamp: startedAt,
      scopeId: entry.scopeId,
      dataType: entry.dataType,
      success: true,
      metadata: { ttl: entry.ttl, size: entry.size },
    });

    this.emitEvent('cache-updated', entry, {
      key,
      ttl: entry.ttl,
      durationMs,
      layer: 'unified-cache',
      operation: 'set',
      size: entry.size,
    });
  }

  clearByType(dataType: string, scopeId?: string): number {
    return this.clearMatchingEntries(
      entry => entry.dataType === dataType && (!scopeId || entry.scopeId === scopeId),
      {
        dataType,
        scopeId,
        layer: 'unified-cache',
      },
    );
  }

  clearScope(scopeId: string): number {
    return this.clearMatchingEntries(
      entry => entry.scopeId === scopeId,
      {
        scopeId,
        layer: 'unified-cache',
      },
    );
  }

  clear(): void {
    const cleared = this.entries.size;
    this.entries.clear();

    this.recordOperation({
      key: '*',
      layer: 'unified-cache',
      operation: 'clear',
      durationMs: 0,
      timestamp: Date.now(),
      success: true,
      metadata: { clearedEntries: cleared },
    });

    this.eventBus.emit('cache-cleared', {
      type: 'cache-cleared',
      source: 'service',
      timestamp: Date.now(),
      metadata: {
        clearedEntries: cleared,
        layer: 'unified-cache',
        operation: 'clear',
      },
    });
  }

  clearByPattern(pattern: RegExp): number {
    return this.clearMatchingEntries(
      entry => pattern.test(entry.key),
      {
        pattern: pattern.source,
        layer: 'unified-cache',
      },
    );
  }

  inspect<T = unknown>(key: string): CacheEntry<T> | null {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return null;
    }

    return cloneEntry(entry);
  }

  listEntries<T = unknown>(): CacheEntry<T>[] {
    this.pruneExpiredEntries();

    return Array.from(this.entries.values()).map(entry => cloneEntry(entry as CacheEntry<T>));
  }

  getStats(): CacheStats {
    const expiredEntries = this.pruneExpiredEntries();
    const entriesByType: Record<string, number> = {};
    const entriesByScope: Record<string, number> = {};
    let memoryUsage = 0;

    this.entries.forEach(entry => {
      const dataType = entry.dataType ?? 'unknown';
      const scopeId = entry.scopeId ?? 'global';
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
      totalOperations: this.recentOperations.length,
    };
  }

  getPerformanceMetrics(windowMs: number = 300000): CachePerformanceMetrics {
    const cutoff = Date.now() - windowMs;
    const operations = this.recentOperations.filter(operation => operation.timestamp >= cutoff);
    const hitOperations = operations.filter(operation => operation.operation === 'hit');
    const missOperations = operations.filter(operation => operation.operation === 'miss');
    const writeOperations = operations.filter(operation => operation.operation === 'set');
    const lookupOperations = hitOperations.length + missOperations.length;

    const averageHitTimeMs = hitOperations.length > 0
      ? hitOperations.reduce((sum, operation) => sum + operation.durationMs, 0) / hitOperations.length
      : 0;
    const averageMissTimeMs = missOperations.length > 0
      ? missOperations.reduce((sum, operation) => sum + operation.durationMs, 0) / missOperations.length
      : 0;

    return {
      totalOperations: operations.length,
      hits: hitOperations.length,
      misses: missOperations.length,
      writes: writeOperations.length,
      hitRate: lookupOperations > 0 ? hitOperations.length / lookupOperations : 0,
      averageHitTimeMs,
      averageMissTimeMs,
      recentOperations: operations.slice(-50),
    };
  }

  getRecentOperations(limit: number = 100): CacheOperationMetrics[] {
    return this.recentOperations.slice(-limit);
  }

  private buildEntry<T>(
    key: string,
    value: T,
    ttl: number,
    metadata?: CacheEntryMetadata,
  ): CacheEntry<T> {
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
      ...metadata,
    };
  }

  private clearMatchingEntries(
    predicate: (entry: CacheEntry<unknown>) => boolean,
    metadata: Record<string, unknown>,
  ): number {
    const removedEntries: CacheEntry<unknown>[] = [];

    this.entries.forEach(entry => {
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
      key: metadata.pattern ? String(metadata.pattern) : `${dataType ?? '*'}:${scopeId ?? '*'}`,
      layer: 'unified-cache',
      operation: 'invalidate',
      durationMs: 0,
      timestamp: Date.now(),
      scopeId,
      dataType,
      success: true,
      metadata: {
        ...metadata,
        clearedEntries: removedEntries.length,
      },
    });

    this.eventBus.emit('cache-invalidated', {
      type: 'cache-invalidated',
      source: 'service',
      scopeId,
      dataType,
      timestamp: Date.now(),
      metadata: {
        ...metadata,
        clearedEntries: removedEntries.length,
        keys: removedEntries.map(entry => entry.key),
        operation: 'invalidate',
      },
    });

    return removedEntries.length;
  }

  private pruneExpiredEntries(): number {
    const now = Date.now();
    let removed = 0;

    this.entries.forEach(entry => {
      if (this.isExpired(entry, now)) {
        this.entries.delete(entry.key);
        removed += 1;
      }
    });

    return removed;
  }

  private isExpired(entry: CacheEntry<unknown>, now: number = Date.now()): boolean {
    return Number.isFinite(entry.expiresAt) && entry.expiresAt <= now;
  }

  private recordOperation(operation: CacheOperationMetrics): void {
    this.recentOperations.push(operation);
    if (this.recentOperations.length > this.maxTrackedOperations) {
      this.recentOperations.splice(0, this.recentOperations.length - this.maxTrackedOperations);
    }
  }

  private emitEvent(
    eventName: CacheEventType,
    entry: CacheEntry<unknown>,
    metadata: Record<string, unknown>,
  ): void {
    const eventType = eventName === 'cache-updated' ? 'data-updated' : eventName === 'cache-cleared' ? 'cache-cleared' : 'cache-invalidated';

    this.eventBus.emit(eventName, {
      type: eventType,
      source: 'service',
      scopeId: entry.scopeId,
      dataType: entry.dataType,
      timestamp: Date.now(),
      metadata,
    });
  }
}
