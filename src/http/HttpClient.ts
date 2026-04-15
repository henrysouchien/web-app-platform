import type { FrontendLogger } from '../logging/Logger';
import { UpgradeRequiredError } from '../errors/UpgradeRequiredError';

export type RetryableHttpError = Error & {
  status?: number;
  retryAfter?: number;
};

export interface HttpRequestOptions extends RequestInit {
  retry?: boolean | number;
}

export interface HttpClientConfig {
  baseURL: string;
  getToken?: () => string | null;
  logger?: FrontendLogger;
  onUnauthorized?: () => void;
  onAuthRetry?: () => Promise<boolean>;
}

export class HttpClient {
  private readonly baseURL: string;
  private readonly getToken?: () => string | null;
  private readonly logger?: FrontendLogger;
  private readonly onUnauthorized?: () => void;
  private readonly onAuthRetry?: () => Promise<boolean>;

  constructor(config: HttpClientConfig) {
    this.baseURL = config.baseURL;
    this.getToken = config.getToken;
    this.logger = config.logger;
    this.onUnauthorized = config.onUnauthorized;
    this.onAuthRetry = config.onAuthRetry;
  }

  /** JSON request/response */
  async request<T>(endpoint: string, options: HttpRequestOptions = {}): Promise<T> {
    const { config, relativeStart, startTime, retries } = this.createRequestConfig(endpoint, options);

    try {
      const response = await this.fetchWithRetry(`${this.baseURL}${endpoint}`, config, retries);
      const data = await response.json();
      const duration = performance.now() - startTime;

      this.logger?.network.response(endpoint, response.status, duration, 'HttpClient');
      if (typeof relativeStart === 'number') {
        this.logger?.network.waterfall(endpoint, relativeStart, duration);
      }

      return data as T;
    } catch (error) {
      this.logger?.network.error(endpoint, this.normalizeError(error), 'HttpClient');
      throw error;
    }
  }

  /** Raw Response for SSE streaming */
  async requestStream(endpoint: string, options: HttpRequestOptions = {}): Promise<Response> {
    const { config, relativeStart, startTime, retries } = this.createRequestConfig(endpoint, options);

    try {
      const response = await this.fetchWithRetry(`${this.baseURL}${endpoint}`, config, retries);
      const duration = performance.now() - startTime;

      this.logger?.network.response(endpoint, response.status, duration, 'HttpClient');
      if (typeof relativeStart === 'number') {
        this.logger?.network.waterfall(endpoint, relativeStart, duration);
      }

      return response;
    } catch (error) {
      this.logger?.network.error(endpoint, this.normalizeError(error), 'HttpClient');
      throw error;
    }
  }

  /** Retry with exponential backoff (internal) */
  private async fetchWithRetry(url: string, options: RequestInit, retries: number): Promise<Response> {
    let authRetried = false;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, options);

        if (response.status === 429) {
          throw this.createHttpError(response, 'Please wait before refreshing again');
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
          throw this.createHttpError(response, 'Session expired');
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

        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }

    throw new Error('Max retries exceeded');
  }

  private createRequestConfig(
    endpoint: string,
    options: HttpRequestOptions
  ): { config: RequestInit; relativeStart?: number; startTime: number; retries: number } {
    const { retry, ...requestOptions } = options;
    const controller = new AbortController();
    const externalSignal = requestOptions.signal;

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), {
          once: true,
        });
      }
    }

    const isFormDataBody = typeof FormData !== 'undefined' && requestOptions.body instanceof FormData;
    const headers = new Headers({
      'X-Requested-With': 'XMLHttpRequest',
    });

    if (!isFormDataBody) {
      headers.set('Content-Type', 'application/json');
    }

    new Headers(requestOptions.headers).forEach((value, key) => {
      if (isFormDataBody && key.toLowerCase() === 'content-type') {
        return;
      }
      headers.set(key, value);
    });

    const token = this.getToken?.();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const method = requestOptions.method ?? 'GET';
    const startTime = performance.now();
    const relativeStart =
      typeof this.logger?.getNavigationElapsed === 'function'
        ? this.logger.getNavigationElapsed()
        : undefined;

    this.logger?.network.request(endpoint, method, requestOptions.body, 'HttpClient');

    return {
      config: {
        ...requestOptions,
        signal: controller.signal,
        credentials: 'include',
        headers,
      },
      retries: retry === false ? 0 : typeof retry === 'number' ? Math.max(0, retry) : 3,
      relativeStart,
      startTime,
    };
  }

  private createHttpError(response: Response, message?: string): RetryableHttpError {
    const error = new Error(
      message ?? `HTTP ${response.status}: ${response.statusText}`
    ) as RetryableHttpError;

    error.status = response.status;

    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10);
      if (!Number.isNaN(parsed)) {
        error.retryAfter = parsed;
      }
    }

    return error;
  }

  private async createUpgradeRequiredError(response: Response): Promise<UpgradeRequiredError | null> {
    const body = await response.clone().json().catch(() => null) as {
      detail?: {
        error?: unknown;
        tier_required?: unknown;
        tier_current?: unknown;
        message?: unknown;
      };
    } | null;

    if (body?.detail?.error !== 'upgrade_required') {
      return null;
    }

    const tierRequired =
      typeof body.detail.tier_required === 'string' ? body.detail.tier_required : 'paid';
    const tierCurrent =
      typeof body.detail.tier_current === 'string' ? body.detail.tier_current : 'registered';
    const message = typeof body.detail.message === 'string' ? body.detail.message : undefined;

    return new UpgradeRequiredError(tierRequired, tierCurrent, message);
  }

  private isRetryableHttpError(error: unknown): error is RetryableHttpError {
    return typeof error === 'object' && error !== null && 'status' in error;
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    return new Error(String(error));
  }
}
