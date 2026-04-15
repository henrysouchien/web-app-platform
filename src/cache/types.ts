export interface CacheEntryMetadata {
  scopeId?: string;
  dataType?: string;
  version?: string;
  userId?: string;
  timestamp?: number;
  tags?: string[];
  [key: string]: unknown;
}

export interface CacheOperationMetrics {
  key: string;
  layer: string;
  operation: 'hit' | 'miss' | 'set' | 'clear' | 'invalidate';
  durationMs: number;
  timestamp: number;
  scopeId?: string;
  dataType?: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export interface StandardCacheKey<TMetadata extends CacheEntryMetadata = CacheEntryMetadata> {
  key: string;
  metadata: TMetadata;
}

export interface ValidatedCacheKeyMetadata extends CacheEntryMetadata {
  scopeId: string;
  dataType: string;
  version: string;
  timestamp: number;
}

const CACHE_KEY_PREFIX = 'cache';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sortValue(item));
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortValue((value as Record<string, unknown>)[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function deterministicStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function generateContentHash(value: unknown): string {
  const serialized = deterministicStringify(value);
  let hash = 0;

  for (let index = 0; index < serialized.length; index += 1) {
    hash = ((hash << 5) - hash) + serialized.charCodeAt(index);
    hash |= 0;
  }

  return `${Math.abs(hash).toString(36)}${serialized.length.toString(36)}`;
}

export function validateCacheKeyMetadata(metadata: CacheEntryMetadata): metadata is ValidatedCacheKeyMetadata {
  return (
    metadata
    && typeof metadata.scopeId === 'string'
    && metadata.scopeId.length > 0
    && typeof metadata.dataType === 'string'
    && metadata.dataType.length > 0
    && typeof metadata.version === 'string'
    && metadata.version.length > 0
    && typeof metadata.timestamp === 'number'
  );
}

export function generateStandardCacheKey(
  baseKey: string,
  metadata: CacheEntryMetadata,
): StandardCacheKey<ValidatedCacheKeyMetadata> {
  const normalizedMetadata: ValidatedCacheKeyMetadata = {
    ...metadata,
    version: metadata.version ?? 'v1',
    timestamp: metadata.timestamp ?? Date.now(),
  } as ValidatedCacheKeyMetadata;

  if (!validateCacheKeyMetadata(normalizedMetadata)) {
    throw new Error('Cache key metadata must include non-empty scopeId and dataType values');
  }

  const key = [
    CACHE_KEY_PREFIX,
    normalizedMetadata.version,
    encodeURIComponent(normalizedMetadata.dataType!),
    encodeURIComponent(normalizedMetadata.scopeId!),
    encodeURIComponent(baseKey),
  ].join('::');

  return {
    key,
    metadata: normalizedMetadata,
  };
}

export function parseStandardCacheKey(key: string): {
  version: string;
  dataType: string;
  scopeId: string;
  baseKey: string;
} | null {
  const parts = key.split('::');
  if (parts.length !== 5 || parts[0] !== CACHE_KEY_PREFIX) {
    return null;
  }

  try {
    return {
      version: parts[1],
      dataType: decodeURIComponent(parts[2]),
      scopeId: decodeURIComponent(parts[3]),
      baseKey: decodeURIComponent(parts[4]),
    };
  } catch {
    return null;
  }
}
