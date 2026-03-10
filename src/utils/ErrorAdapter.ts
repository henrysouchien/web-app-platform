export interface ErrorEnvelope {
  success: boolean;
  error_code?: string;
  message?: string;
  details?: unknown;
}

export class ErrorAdapter {
  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  static transformError(error: unknown): ErrorEnvelope {
    if (this.isRecord(error) && 'success' in error) {
      const maybeCode = error.error_code;
      const maybeMessage = error.message ?? error.error;
      return {
        success: false,
        error_code: typeof maybeCode === 'string' ? maybeCode : 'UNKNOWN_ERROR',
        message: typeof maybeMessage === 'string' ? maybeMessage : 'An error occurred',
        details: error.details ?? error,
      };
    }

    if (typeof error === 'string') {
      return {
        success: false,
        error_code: 'STRING_ERROR',
        message: error,
        details: null,
      };
    }

    if (error instanceof Error) {
      return {
        success: false,
        error_code: error.name || 'ERROR_OBJECT',
        message: error.message,
        details: error.stack,
      };
    }

    if (this.isRecord(error) && typeof error.status === 'number') {
      const statusText = typeof error.statusText === 'string' ? error.statusText : `HTTP Error ${error.status}`;
      return {
        success: false,
        error_code: `HTTP_${error.status}`,
        message: statusText,
        details: error,
      };
    }

    return {
      success: false,
      error_code: 'UNKNOWN_ERROR',
      message: 'An unknown error occurred',
      details: error,
    };
  }

  static createSuccess(data: unknown): ErrorEnvelope & { data: unknown } {
    return {
      success: true,
      data,
    };
  }

  static isError(response: unknown): boolean {
    return this.isRecord(response) && response.success === false;
  }

  static getErrorMessage(error: unknown): string {
    const envelope = this.transformError(error);
    return envelope.message || 'An error occurred';
  }
}
