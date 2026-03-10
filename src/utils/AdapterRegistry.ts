import type { UnifiedCache } from '../cache/UnifiedCache';

function hashArgs(args: unknown[]): string {
  let seen = new WeakSet<object>();

  const validateSerializable = (value: unknown, path: string = 'root'): void => {
    const type = typeof value;

    if (type === 'function') {
      throw new Error(`AdapterRegistry keys must be serializable primitives or plain objects. Found function at ${path}`);
    }

    if (type === 'symbol') {
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

    if (type === 'object' && value !== null) {
      if (seen.has(value as object)) {
        return;
      }
      seen.add(value as object);

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          validateSerializable(item, `${path}[${index}]`);
        });
      } else if (!(value instanceof Date)) {
        const obj = value as Record<string, unknown>;
        Object.entries(obj).forEach(([key, val]) => {
          validateSerializable(val, `${path}.${key}`);
        });
      }
    }
  };

  const serialize = (value: unknown): string => {
    if (value === null) {
      return 'null';
    }
    if (value === undefined) {
      return 'undefined';
    }

    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') {
      return `${type}:${value}`;
    }

    if (type === 'object') {
      if (seen.has(value as object)) {
        return 'circular';
      }
      seen.add(value as object);

      if (Array.isArray(value)) {
        return `array:[${value.map(serialize).join(',')}]`;
      }

      if (value instanceof Date) {
        return `date:${value.toISOString()}`;
      }

      const obj = value as Record<string, unknown>;
      const sortedKeys = Object.keys(obj).sort();
      const pairs = sortedKeys.map(key => `${key}:${serialize(obj[key])}`);
      return `object:{${pairs.join(',')}}`;
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

  seen = new WeakSet();

  return args.map(serialize).join('|');
}

export class AdapterRegistry {
  private static instances = new Map<string, unknown>();

  static getAdapter<T>(type: string, args: unknown[], factory: () => T): T;

  static getAdapter<T>(
    type: string,
    args: unknown[],
    factory: (unifiedCache?: UnifiedCache) => T,
    unifiedCache: UnifiedCache,
  ): T;

  static getAdapter<T>(
    type: string,
    args: unknown[],
    factory: (() => T) | ((unifiedCache?: UnifiedCache) => T),
    unifiedCache?: UnifiedCache,
  ): T {
    if (typeof type !== 'string' || type.length === 0) {
      throw new Error('AdapterRegistry: type must be a non-empty string');
    }

    const key = `${type}::${hashArgs(args)}`;
    if (!this.instances.has(key)) {
      if (unifiedCache) {
        this.instances.set(key, (factory as (cache?: UnifiedCache) => T)(unifiedCache));
      } else {
        this.instances.set(key, (factory as () => T)());
      }
    }

    return this.instances.get(key) as T;
  }

  static clear(): void {
    this.instances.clear();
  }

  static delete(type: string, args: unknown[]): void {
    const key = `${type}::${hashArgs(args)}`;
    this.instances.delete(key);
  }

  static size(): number {
    return this.instances.size;
  }

  static has(type: string, args: unknown[]): boolean {
    const key = `${type}::${hashArgs(args)}`;
    return this.instances.has(key);
  }
}
