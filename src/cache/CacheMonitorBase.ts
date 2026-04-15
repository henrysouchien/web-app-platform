import type { EventBus } from '../events/EventBus';
import type { CacheOperationMetrics } from './types';

export type CacheMetrics = CacheOperationMetrics;

export interface LayerPerformance {
  layer: string;
  operations: number;
  hits: number;
  misses: number;
  hitRate: number;
  averageResponseTime: number;
  slowOperations: number;
}

export interface CacheAlerts {
  slowLayers: string[];
  hotKeys: string[];
  highMissRateLayers: string[];
}

export interface CachePerformanceReport {
  generatedAt: number;
  timeRangeMs: number;
  totalOperations: number;
  hitRate: number;
  layers: LayerPerformance[];
  recentOperations: CacheMetrics[];
  alerts: CacheAlerts;
}

export interface CacheMonitorConfig {
  eventNames?: string[];
  maxRecentOperations?: number;
  slowOperationThresholdMs?: number;
  hotKeyThreshold?: number;
  highMissRateThreshold?: number;
}

interface CacheEventLike {
  type?: string;
  scopeId?: string;
  portfolioId?: string;
  dataType?: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

const CACHE_EVENT_NAMES = [
  'cache-hit',
  'cache-miss',
  'cache-updated',
  'cache-invalidated',
  'cache-cleared',
];

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export class CacheMonitorBase {
  private readonly recentOperations: CacheMetrics[] = [];
  private readonly unsubscribers: Array<() => void> = [];
  private readonly config: Required<CacheMonitorConfig>;

  constructor(private readonly eventBus: EventBus, config: CacheMonitorConfig = {}) {
    this.config = {
      eventNames: config.eventNames ?? [],
      maxRecentOperations: config.maxRecentOperations ?? 500,
      slowOperationThresholdMs: config.slowOperationThresholdMs ?? 150,
      hotKeyThreshold: config.hotKeyThreshold ?? 5,
      highMissRateThreshold: config.highMissRateThreshold ?? 0.4,
    };

    this.subscribeToEvents();
  }

  trackCacheHit(layer: string, key: string, responseTime: number, dataType?: string, scopeId?: string): void {
    this.recordMetric({
      layer,
      key,
      operation: 'hit',
      durationMs: responseTime,
      timestamp: Date.now(),
      scopeId,
      dataType,
      success: true,
    });
  }

  trackCacheMiss(layer: string, key: string, fetchTime: number, dataType?: string, scopeId?: string): void {
    this.recordMetric({
      layer,
      key,
      operation: 'miss',
      durationMs: fetchTime,
      timestamp: Date.now(),
      scopeId,
      dataType,
      success: true,
    });
  }

  generateReport(timeRangeMs: number = 300000): CachePerformanceReport {
    const cutoff = Date.now() - timeRangeMs;
    const operations = this.recentOperations.filter(operation => operation.timestamp >= cutoff);
    const layers = this.buildLayerPerformance(operations);
    const hits = operations.filter(operation => operation.operation === 'hit').length;
    const misses = operations.filter(operation => operation.operation === 'miss').length;
    const totalLookups = hits + misses;

    return {
      generatedAt: Date.now(),
      timeRangeMs,
      totalOperations: operations.length,
      hitRate: totalLookups > 0 ? hits / totalLookups : 0,
      layers,
      recentOperations: operations.slice(-100),
      alerts: this.buildAlerts(operations, layers),
    };
  }

  getLayerMetrics(layer: string): CacheMetrics[] {
    return this.recentOperations.filter(operation => operation.layer === layer);
  }

  getScopeMetrics(scopeId: string): CacheMetrics[] {
    return this.recentOperations.filter(operation => operation.scopeId === scopeId);
  }

  getRecentOperations(limit: number = 100): CacheMetrics[] {
    return this.recentOperations.slice(-limit);
  }

  dispose(): void {
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers.length = 0;
  }

  private subscribeToEvents(): void {
    const subscribedEvents = new Set([...CACHE_EVENT_NAMES, ...this.config.eventNames]);

    subscribedEvents.forEach(eventName => {
      const unsubscribe = this.eventBus.on<CacheEventLike>(eventName, event => {
        this.recordMetric(this.metricFromEvent(eventName, event));
      });
      this.unsubscribers.push(unsubscribe);
    });
  }

  private metricFromEvent(eventName: string, event: CacheEventLike): CacheMetrics {
    const metadata = toRecord(event.metadata);
    const scopeId = typeof event.scopeId === 'string'
      ? event.scopeId
      : typeof event.portfolioId === 'string'
        ? event.portfolioId
        : undefined;
    const key = typeof metadata.key === 'string'
      ? metadata.key
      : `${eventName}:${event.dataType ?? 'unknown'}:${scopeId ?? 'global'}`;
    const durationMs = typeof metadata.durationMs === 'number' ? metadata.durationMs : 0;
    const layer = typeof metadata.layer === 'string' ? metadata.layer : this.resolveLayer(eventName);

    return {
      layer,
      key,
      operation: this.resolveOperation(eventName),
      durationMs,
      timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
      scopeId,
      dataType: event.dataType,
      success: true,
      metadata,
    };
  }

  private resolveLayer(eventName: string): string {
    if (eventName.startsWith('cache-')) {
      return 'unified-cache';
    }

    if (eventName.includes('risk')) {
      return 'risk-coordinator';
    }

    if (eventName.includes('portfolio')) {
      return 'portfolio-coordinator';
    }

    return 'cache-monitor';
  }

  private resolveOperation(eventName: string): CacheMetrics['operation'] {
    if (eventName === 'cache-hit') {
      return 'hit';
    }

    if (eventName === 'cache-miss') {
      return 'miss';
    }

    if (eventName === 'cache-updated') {
      return 'set';
    }

    if (eventName === 'cache-cleared') {
      return 'clear';
    }

    return 'invalidate';
  }

  private recordMetric(metric: CacheMetrics): void {
    this.recentOperations.push(metric);
    if (this.recentOperations.length > this.config.maxRecentOperations) {
      this.recentOperations.splice(0, this.recentOperations.length - this.config.maxRecentOperations);
    }
  }

  private buildLayerPerformance(operations: CacheMetrics[]): LayerPerformance[] {
    const byLayer = new Map<string, CacheMetrics[]>();

    operations.forEach(operation => {
      const layerOperations = byLayer.get(operation.layer) ?? [];
      layerOperations.push(operation);
      byLayer.set(operation.layer, layerOperations);
    });

    return Array.from(byLayer.entries()).map(([layer, layerOperations]) => {
      const hits = layerOperations.filter(operation => operation.operation === 'hit').length;
      const misses = layerOperations.filter(operation => operation.operation === 'miss').length;
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
          operation => operation.durationMs >= this.config.slowOperationThresholdMs,
        ).length,
      };
    });
  }

  private buildAlerts(operations: CacheMetrics[], layers: LayerPerformance[]): CacheAlerts {
    const keyCounts = new Map<string, number>();
    const missCounts = new Map<string, { misses: number; totalLookups: number }>();

    operations.forEach(operation => {
      keyCounts.set(operation.key, (keyCounts.get(operation.key) ?? 0) + 1);

      if (operation.operation === 'hit' || operation.operation === 'miss') {
        const counts = missCounts.get(operation.layer) ?? { misses: 0, totalLookups: 0 };
        counts.totalLookups += 1;
        if (operation.operation === 'miss') {
          counts.misses += 1;
        }
        missCounts.set(operation.layer, counts);
      }
    });

    return {
      slowLayers: layers
        .filter(layer => layer.slowOperations > 0)
        .map(layer => layer.layer),
      hotKeys: Array.from(keyCounts.entries())
        .filter(([, count]) => count >= this.config.hotKeyThreshold)
        .map(([key]) => key),
      highMissRateLayers: Array.from(missCounts.entries())
        .filter(([, counts]) => counts.totalLookups > 0 && counts.misses / counts.totalLookups >= this.config.highMissRateThreshold)
        .map(([layer]) => layer),
    };
  }
}
