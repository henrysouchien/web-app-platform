import type { EventBus } from '../events/EventBus';
import type { CacheMonitorBase, CacheMetrics } from './CacheMonitorBase';
import type { CacheEntry, CacheStats, UnifiedCache } from './UnifiedCache';

export interface CacheCoordinatorLike {
  clearAll?: () => void;
}

export interface CacheKeyInfo {
  key: string;
  dataType?: string;
  scopeId?: string;
  ttl: number;
  expiresAt: number;
  ageMs: number;
  remainingTtlMs: number | null;
  hitCount: number;
  size: number;
  isExpired: boolean;
}

export interface LayerState {
  layer: string;
  entryCount: number;
  memoryUsage: number;
  keys: CacheKeyInfo[];
}

export interface CacheStateReport {
  generatedAt: number;
  totalEntries: number;
  totalMemoryUsage: number;
  stats: CacheStats;
  layers: LayerState[];
  activeDebugSession: DebugSession | null;
}

export interface KeyCollision {
  normalizedKey: string;
  keys: string[];
  count: number;
}

export interface InvalidationStep {
  timestamp: number;
  event: string;
  description: string;
  scopeId?: string;
}

export interface InvalidationFlowDiagram {
  dataType: string;
  scopeId: string;
  steps: InvalidationStep[];
}

export type DebugOperation = CacheMetrics;

export interface DebugFilters {
  layer?: string;
  scopeIds?: string[];
  dataTypes?: string[];
  operations?: Array<DebugOperation['operation']>;
  since?: number;
}

export interface DebugSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  filters: DebugFilters;
  operations: DebugOperation[];
}

interface CacheEventLike {
  scopeId?: string;
  portfolioId?: string;
  dataType?: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

const DEBUG_EVENT_NAMES = [
  'cache-hit',
  'cache-miss',
  'cache-updated',
  'cache-invalidated',
  'cache-cleared',
  'risk-data-invalidated',
  'portfolio-data-invalidated',
  'user-data-invalidated',
];

function normalizeKeyInfo(entry: CacheEntry<unknown>): CacheKeyInfo {
  const now = Date.now();
  const remainingTtlMs = Number.isFinite(entry.expiresAt)
    ? Math.max(entry.expiresAt - now, 0)
    : null;

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
    isExpired: remainingTtlMs === 0 && Number.isFinite(entry.expiresAt),
  };
}

export class CacheDebugger {
  private activeSession: DebugSession | null = null;
  private unsubscribeSessionEvents: Array<() => void> = [];

  constructor(
    private readonly eventBus: EventBus,
    private readonly unifiedCache: UnifiedCache,
    private readonly cacheMonitor: CacheMonitorBase,
    private readonly cacheCoordinator: CacheCoordinatorLike,
  ) {}

  inspectCacheState(): CacheStateReport {
    const entries = this.unifiedCache.listEntries();
    const groupedLayers = new Map<string, CacheKeyInfo[]>();

    entries.forEach(entry => {
      const layer = entry.dataType ?? 'unknown';
      const layerEntries = groupedLayers.get(layer) ?? [];
      layerEntries.push(normalizeKeyInfo(entry));
      groupedLayers.set(layer, layerEntries);
    });

    const layers = Array.from(groupedLayers.entries()).map(([layer, keys]) => ({
      layer,
      entryCount: keys.length,
      memoryUsage: keys.reduce((sum, key) => sum + key.size, 0),
      keys,
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
        filters: { ...this.activeSession.filters },
      } : null,
    };
  }

  startDebugSession(filters: DebugFilters = {}): string {
    if (this.activeSession) {
      this.stopDebugSession();
    }

    const sessionId = `debug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.activeSession = {
      id: sessionId,
      startedAt: Date.now(),
      filters: { ...filters },
      operations: [],
    };

    this.unsubscribeSessionEvents = DEBUG_EVENT_NAMES.map(eventName => (
      this.eventBus.on<CacheEventLike>(eventName, event => {
        if (!this.activeSession) {
          return;
        }

        const operation = this.toDebugOperation(eventName, event);
        if (this.matchesFilters(operation, this.activeSession.filters)) {
          this.activeSession.operations.push(operation);
        }
      })
    ));

    return sessionId;
  }

  stopDebugSession(): DebugSession | null {
    if (!this.activeSession) {
      return null;
    }

    this.unsubscribeSessionEvents.forEach(unsubscribe => unsubscribe());
    this.unsubscribeSessionEvents = [];

    const completedSession: DebugSession = {
      ...this.activeSession,
      endedAt: Date.now(),
      operations: [...this.activeSession.operations],
      filters: { ...this.activeSession.filters },
    };

    this.activeSession = null;
    return completedSession;
  }

  visualizeInvalidationFlow(dataType: string): InvalidationFlowDiagram {
    const recentOperations = this.cacheMonitor
      .generateReport(3600000)
      .recentOperations
      .filter(operation => operation.dataType === dataType)
      .filter(operation => operation.operation === 'invalidate' || operation.operation === 'clear');

    const scopeId = recentOperations[0]?.scopeId ?? 'global';
    const steps = recentOperations.length > 0
      ? recentOperations.map(operation => ({
        timestamp: operation.timestamp,
        event: operation.operation,
        description: `${operation.layer} ${operation.operation} on ${operation.key}`,
        scopeId: operation.scopeId,
      }))
      : [{
        timestamp: Date.now(),
        event: 'none',
        description: `No invalidation activity recorded for ${dataType}`,
        scopeId,
      }];

    return {
      dataType,
      scopeId,
      steps,
    };
  }

  findPerformanceBottlenecks(): {
    slowOperations: DebugOperation[];
    frequentMisses: { key: string; count: number }[];
    memoryHogs: { layer: string; usage: number }[];
    recommendations: string[];
  } {
    const report = this.cacheMonitor.generateReport(3600000);
    const slowOperations = report.recentOperations.filter(operation => operation.durationMs >= 150);
    const missCounts = new Map<string, number>();

    report.recentOperations
      .filter(operation => operation.operation === 'miss')
      .forEach(operation => {
        missCounts.set(operation.key, (missCounts.get(operation.key) ?? 0) + 1);
      });

    const frequentMisses = Array.from(missCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([key, count]) => ({ key, count }));

    const memoryHogs = this.inspectCacheState()
      .layers
      .map(layer => ({ layer: layer.layer, usage: layer.memoryUsage }))
      .sort((left, right) => right.usage - left.usage)
      .slice(0, 5);

    const recommendations: string[] = [];
    if (report.alerts.highMissRateLayers.length > 0) {
      recommendations.push(`Review miss-heavy layers: ${report.alerts.highMissRateLayers.join(', ')}`);
    }
    if (slowOperations.length > 0) {
      recommendations.push('Reduce expensive cache population paths or increase warm-up coverage.');
    }
    if (memoryHogs.length > 0 && memoryHogs[0].usage > 250_000) {
      recommendations.push(`Trim oversized cache layer ${memoryHogs[0].layer} or reduce TTLs.`);
    }
    if (recommendations.length === 0) {
      recommendations.push('No obvious cache bottlenecks detected in the current sample window.');
    }

    return {
      slowOperations,
      frequentMisses,
      memoryHogs,
      recommendations,
    };
  }

  clearAll(): void {
    this.cacheCoordinator.clearAll?.();
  }

  private toDebugOperation(eventName: string, event: CacheEventLike): DebugOperation {
    const metadata = event.metadata ?? {};
    const scopeId = typeof event.scopeId === 'string'
      ? event.scopeId
      : typeof event.portfolioId === 'string'
        ? event.portfolioId
        : undefined;

    return {
      layer: typeof metadata.layer === 'string' ? metadata.layer : 'debug-session',
      key: typeof metadata.key === 'string' ? metadata.key : `${eventName}:${event.dataType ?? 'unknown'}`,
      operation: eventName === 'cache-hit'
        ? 'hit'
        : eventName === 'cache-miss'
          ? 'miss'
          : eventName === 'cache-updated'
            ? 'set'
            : eventName === 'cache-cleared'
              ? 'clear'
              : 'invalidate',
      durationMs: typeof metadata.durationMs === 'number' ? metadata.durationMs : 0,
      timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
      scopeId,
      dataType: event.dataType,
      success: true,
      metadata,
    };
  }

  private matchesFilters(operation: DebugOperation, filters: DebugFilters): boolean {
    if (filters.layer && operation.layer !== filters.layer) {
      return false;
    }

    if (filters.scopeIds && filters.scopeIds.length > 0 && !filters.scopeIds.includes(operation.scopeId ?? '')) {
      return false;
    }

    if (filters.dataTypes && filters.dataTypes.length > 0 && !filters.dataTypes.includes(operation.dataType ?? '')) {
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
}
