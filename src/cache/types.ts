export interface CacheKeyMetadata {
  scopeId: string;
  dataType: string;
  version?: string;
  userId?: string;
  timestamp?: number;
}

export interface StandardCacheKey {
  key: string;
  metadata: CacheKeyMetadata;
}

export function generateStandardCacheKey(baseKey: string, metadata: CacheKeyMetadata): StandardCacheKey {
  const keyParts = [
    metadata.dataType,
    metadata.scopeId,
    baseKey,
    metadata.version || 'v1',
  ].filter(Boolean);

  return {
    key: keyParts.join('_'),
    metadata: {
      ...metadata,
      timestamp: Date.now(),
    },
  };
}

export function parseStandardCacheKey(key: string): {
  dataType: string;
  scopeId: string;
  baseKey: string;
  version: string;
} | null {
  const parts = key.split('_');
  if (parts.length < 4) {
    return null;
  }

  return {
    dataType: parts[0],
    scopeId: parts[1],
    baseKey: parts.slice(2, -1).join('_'),
    version: parts[parts.length - 1],
  };
}

export function validateCacheKeyMetadata(metadata: CacheKeyMetadata): boolean {
  return !!(
    metadata.scopeId &&
    metadata.dataType &&
    typeof metadata.scopeId === 'string' &&
    typeof metadata.dataType === 'string'
  );
}

export function generateContentHash(content: unknown): string {
  const str = JSON.stringify(content);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash &= hash;
  }
  return Math.abs(hash).toString(36);
}

export interface CacheEntryMetadata {
  key: string;
  scopeId?: string;
  dataType?: string;
  createdAt: number;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
}

export interface CacheOperationMetrics {
  operation: 'hit' | 'miss' | 'set' | 'clear' | 'expire';
  key: string;
  dataType?: string;
  scopeId?: string;
  responseTime: number;
  timestamp: number;
  success: boolean;
  error?: string;
}
