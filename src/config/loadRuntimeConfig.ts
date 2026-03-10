import type { FrontendLogger } from '../logging/Logger';

interface RuntimeConfigSchema<T> {
  parse: (input: unknown) => T;
}

interface RuntimeConfigLoaderOptions<T> {
  /** Zod schema for validation */
  schema: RuntimeConfigSchema<T>;
  /** Build raw config object from environment - called on first load */
  buildRawConfig: () => Record<string, unknown>;
  /** Default config to use when validation fails in dev */
  defaults: T;
  /** Optional logger for error/warning reporting */
  logger?: FrontendLogger;
}

export function createRuntimeConfigLoader<T>(options: RuntimeConfigLoaderOptions<T>) {
  let cachedConfig: T | null = null;

  function loadRuntimeConfig(): T {
    if (cachedConfig) {
      return cachedConfig;
    }

    try {
      const rawConfig = options.buildRawConfig();
      cachedConfig = options.schema.parse(rawConfig);
      return cachedConfig;
    } catch (error) {
      options.logger?.error?.(
        'Runtime configuration validation failed',
        'loadRuntimeConfig',
        error instanceof Error ? error : new Error(String(error)),
      );

      if (import.meta.env.PROD) {
        throw new Error(`Invalid runtime configuration: ${error}`);
      }

      options.logger?.warning?.(
        'Using default configuration due to validation error',
        'loadRuntimeConfig',
      );
      cachedConfig = options.defaults;
      return cachedConfig;
    }
  }

  function clearConfigCache(): void {
    cachedConfig = null;
  }

  return { loadRuntimeConfig, clearConfigCache };
}
