import type { CacheEvent } from '../events/EventBus';
import type { EventBus } from '../events/EventBus';
import { frontendLogger } from '../logging/Logger';

export interface CacheMetrics {
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

export interface LayerPerformance {
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

export interface CachePerformanceReport {
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

export interface CacheAlerts {
  lowHitRatio: { layer: string; ratio: number; threshold: number }[];
  slowOperations: { layer: string; avgTime: number; threshold: number }[];
  highMemoryUsage: { layer: string; usage: number; threshold: number }[];
  frequentMisses: { key: string; count: number; layer: string }[];
}

export class CacheMonitorBase {
  private metrics: CacheMetrics[] = [];
  private layerStats = new Map<string, LayerPerformance>();
  private readonly maxMetricsHistory = 10000;
  private readonly alertThresholds = {
    hitRatio: 0.7,
    responseTime: 1000,
    memoryUsage: 100 * 1024 * 1024,
    missFrequency: 10,
  };

  constructor(
    private eventBus: EventBus,
    private config: { eventNames: string[] },
  ) {
    this.setupEventListeners();
    frontendLogger.adapter.transformSuccess('CacheMonitorBase', 'Initialized with event listeners');
  }

  private setupEventListeners(): void {
    this.eventBus.on<CacheEvent>('cache-updated', event => {
      const eventKey = typeof event.metadata?.key === 'string' ? event.metadata.key : 'unknown';
      this.trackCacheOperation({
        layer: event.source || 'unknown',
        operation: 'set',
        key: eventKey,
        responseTime: 0,
        dataType: event.dataType,
        scopeId: event.scopeId,
        timestamp: event.timestamp || Date.now(),
      });
    });

    this.eventBus.on<CacheEvent>('cache-cleared', event => {
      const metadataPattern = typeof event.metadata?.pattern === 'string' ? event.metadata.pattern : null;
      const metadataKey = typeof event.metadata?.key === 'string' ? event.metadata.key : null;
      this.trackCacheOperation({
        layer: event.source || 'unknown',
        operation: 'clear',
        key: metadataPattern || metadataKey || 'bulk-clear',
        responseTime: 0,
        dataType: event.dataType,
        scopeId: event.scopeId,
        timestamp: event.timestamp || Date.now(),
      });
    });

    Array.from(new Set(this.config.eventNames)).forEach(eventName => {
      this.eventBus.on<CacheEvent>(eventName, event => {
        this.trackCacheOperation({
          layer: event.source || 'coordinator',
          operation: 'invalidate',
          key: event.scopeId ? `${eventName}-${event.scopeId}` : eventName,
          responseTime: 0,
          dataType: event.dataType,
          scopeId: event.scopeId,
          timestamp: event.timestamp || Date.now(),
        });
      });
    });
  }

  trackCacheHit(layer: string, key: string, responseTime: number, dataType?: string, scopeId?: string): void {
    this.trackCacheOperation({
      layer,
      operation: 'hit',
      key,
      responseTime,
      dataType,
      scopeId,
      timestamp: Date.now(),
    });
  }

  trackCacheMiss(layer: string, key: string, fetchTime: number, dataType?: string, scopeId?: string): void {
    this.trackCacheOperation({
      layer,
      operation: 'miss',
      key,
      responseTime: fetchTime,
      dataType,
      scopeId,
      timestamp: Date.now(),
    });
  }

  private trackCacheOperation(metric: CacheMetrics): void {
    this.metrics.push(metric);

    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }

    this.updateLayerStats(metric);

    if (metric.operation === 'miss' && metric.responseTime > this.alertThresholds.responseTime) {
      frontendLogger.adapter.transformError('CacheMonitorBase', new Error('Slow cache miss detected'), {
        layer: metric.layer,
        key: metric.key,
        responseTime: metric.responseTime,
      });
    }
  }

  private updateLayerStats(metric: CacheMetrics): void {
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
        lastActivity: Date.now(),
      };
      this.layerStats.set(layerKey, stats);
    }

    stats.totalOperations++;
    stats.lastActivity = metric.timestamp;
    stats.totalResponseTime += metric.responseTime;
    stats.avgResponseTime = stats.totalResponseTime / stats.totalOperations;

    if (metric.operation === 'hit') {
      stats.hits++;
    } else if (metric.operation === 'miss') {
      stats.misses++;
    }

    const totalHitMissOps = stats.hits + stats.misses;
    if (totalHitMissOps > 0) {
      stats.hitRatio = stats.hits / totalHitMissOps;
    }

    if (metric.cacheSize !== undefined) {
      stats.cacheSize = metric.cacheSize;
    }
    if (metric.memoryUsage !== undefined) {
      stats.memoryUsage = metric.memoryUsage;
    }
  }

  generateReport(timeRangeMs: number = 300000): CachePerformanceReport {
    const now = Date.now();
    const startTime = now - timeRangeMs;
    const recentMetrics = this.metrics.filter(m => m.timestamp >= startTime);
    const layers = Array.from(this.layerStats.values());
    const totalOperations = layers.reduce((sum, layer) => sum + layer.totalOperations, 0);
    const totalHits = layers.reduce((sum, layer) => sum + layer.hits, 0);
    const totalMisses = layers.reduce((sum, layer) => sum + layer.misses, 0);
    const overallHitRatio = totalHits + totalMisses > 0 ? totalHits / (totalHits + totalMisses) : 0;
    const avgResponseTime = layers.length > 0
      ? layers.reduce((sum, layer) => sum + layer.avgResponseTime, 0) / layers.length
      : 0;
    const totalMemoryUsage = layers.reduce((sum, layer) => sum + layer.memoryUsage, 0);
    const mostActiveLayer = layers.reduce(
      (max, layer) => (layer.totalOperations > max.totalOperations ? layer : max),
      layers[0] || { layer: 'none', totalOperations: 0 },
    );
    const slowestLayer = layers.reduce(
      (max, layer) => (layer.avgResponseTime > max.avgResponseTime ? layer : max),
      layers[0] || { layer: 'none', avgResponseTime: 0 },
    );
    const recommendations = this.generateRecommendations(layers);

    const report: CachePerformanceReport = {
      reportId: `cache-report-${now}`,
      generatedAt: now,
      timeRange: {
        start: startTime,
        end: now,
        durationMs: timeRangeMs,
      },
      layers,
      summary: {
        totalOperations,
        overallHitRatio,
        avgResponseTime,
        totalMemoryUsage,
        mostActiveLayer: mostActiveLayer.layer,
        slowestLayer: slowestLayer.layer,
        recommendations,
      },
      recentOperations: recentMetrics.slice(-50),
    };

    frontendLogger.adapter.transformSuccess('CacheMonitorBase', {
      message: 'Performance report generated',
      reportId: report.reportId,
      totalOperations,
      overallHitRatio: Math.round(overallHitRatio * 100),
      layerCount: layers.length,
    });

    return report;
  }

  private generateRecommendations(layers: LayerPerformance[]): string[] {
    const recommendations: string[] = [];

    layers.forEach(layer => {
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
      recommendations.push('Cache performance is within acceptable thresholds.');
    }

    return recommendations;
  }

  getAlerts(): CacheAlerts {
    const layers = Array.from(this.layerStats.values());

    return {
      lowHitRatio: layers
        .filter(layer => layer.hitRatio < this.alertThresholds.hitRatio)
        .map(layer => ({
          layer: layer.layer,
          ratio: layer.hitRatio,
          threshold: this.alertThresholds.hitRatio,
        })),
      slowOperations: layers
        .filter(layer => layer.avgResponseTime > this.alertThresholds.responseTime)
        .map(layer => ({
          layer: layer.layer,
          avgTime: layer.avgResponseTime,
          threshold: this.alertThresholds.responseTime,
        })),
      highMemoryUsage: layers
        .filter(layer => layer.memoryUsage > this.alertThresholds.memoryUsage)
        .map(layer => ({
          layer: layer.layer,
          usage: layer.memoryUsage,
          threshold: this.alertThresholds.memoryUsage,
        })),
      frequentMisses: this.getFrequentMisses(),
    };
  }

  private getFrequentMisses(): { key: string; count: number; layer: string }[] {
    const missCount = new Map<string, { count: number; layer: string }>();

    this.metrics
      .filter(m => m.operation === 'miss')
      .forEach(m => {
        const key = `${m.layer}:${m.key}`;
        const existing = missCount.get(key);
        if (existing) {
          existing.count++;
        } else {
          missCount.set(key, { count: 1, layer: m.layer });
        }
      });

    return Array.from(missCount.entries())
      .filter(([_, data]) => data.count >= this.alertThresholds.missFrequency)
      .map(([key, data]) => ({
        key: key.split(':')[1],
        count: data.count,
        layer: data.layer,
      }))
      .sort((a, b) => b.count - a.count);
  }

  getRealtimeStats(): { layers: LayerPerformance[]; alerts: CacheAlerts } {
    return {
      layers: Array.from(this.layerStats.values()),
      alerts: this.getAlerts(),
    };
  }

  clearMetrics(): void {
    this.metrics = [];
    this.layerStats.clear();
    frontendLogger.adapter.transformSuccess('CacheMonitorBase', 'All metrics cleared');
  }

  getLayerMetrics(layer: string): CacheMetrics[] {
    return this.metrics.filter(m => m.layer === layer);
  }

  getScopeMetrics(scopeId: string): CacheMetrics[] {
    return this.metrics.filter(m => m.scopeId === scopeId);
  }
}
