const LOCALE = 'en-US';
const CURRENCY = 'USD';
const NO_DATA = '—';

const commonCurrencyFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const commonCompactCurrencyFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  notation: 'compact',
  compactDisplay: 'short',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const commonNumberFormatter0 = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const commonNumberFormatter1 = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const commonNumberFormatter2 = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const commonCompactNumberFormatter = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  compactDisplay: 'short',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const commonCompactNumberFormatter0 = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  compactDisplay: 'short',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();
const numberFormatterCache = new Map<number, Intl.NumberFormat>();
const compactFormatterCache = new Map<number, Intl.NumberFormat>();

const normalizeNegativeZero = (value: number): number => (Object.is(value, -0) ? 0 : value);

const toFiniteValue = (value: number): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }
  return normalizeNegativeZero(value);
};

const normalizeDecimals = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(20, Math.trunc(value)));
};

const getNumberFormatter = (decimals: number): Intl.NumberFormat => {
  if (decimals === 0) {
    return commonNumberFormatter0;
  }
  if (decimals === 1) {
    return commonNumberFormatter1;
  }
  if (decimals === 2) {
    return commonNumberFormatter2;
  }

  const cached = numberFormatterCache.get(decimals);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  numberFormatterCache.set(decimals, formatter);
  return formatter;
};

const getCurrencyFormatter = (decimals: number, compact: boolean): Intl.NumberFormat => {
  if (!compact && decimals === 0) {
    return commonCurrencyFormatter;
  }
  if (compact && decimals === 1) {
    return commonCompactCurrencyFormatter;
  }

  const cacheKey = `${compact ? 'compact' : 'standard'}:${decimals}`;
  const cached = currencyFormatterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: CURRENCY,
    notation: compact ? 'compact' : 'standard',
    compactDisplay: compact ? 'short' : undefined,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  currencyFormatterCache.set(cacheKey, formatter);
  return formatter;
};

const getCompactFormatter = (decimals: number): Intl.NumberFormat => {
  if (decimals === 0) {
    return commonCompactNumberFormatter0;
  }
  if (decimals === 1) {
    return commonCompactNumberFormatter;
  }

  const cached = compactFormatterCache.get(decimals);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat(LOCALE, {
    notation: 'compact',
    compactDisplay: 'short',
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
  compactFormatterCache.set(decimals, formatter);
  return formatter;
};

const withSign = (value: number, formatted: string, sign: boolean): string => {
  if (!sign) {
    return formatted;
  }
  return value >= 0 ? `+${formatted}` : formatted;
};

export function formatCurrency(
  value: number,
  opts?: { decimals?: number; compact?: boolean },
): string {
  const finite = toFiniteValue(value);
  if (finite === null) {
    return NO_DATA;
  }

  const compact = opts?.compact === true;
  const decimals = normalizeDecimals(opts?.decimals, compact ? 1 : 0);
  return getCurrencyFormatter(decimals, compact).format(finite);
}

export function formatPercent(
  value: number,
  opts?: { decimals?: number; sign?: boolean },
): string {
  const finite = toFiniteValue(value);
  if (finite === null) {
    return NO_DATA;
  }

  const decimals = normalizeDecimals(opts?.decimals, 1);
  const formatted = getNumberFormatter(decimals).format(finite);
  return `${withSign(finite, formatted, opts?.sign === true)}%`;
}

export function formatNumber(
  value: number,
  opts?: { decimals?: number; sign?: boolean },
): string {
  const finite = toFiniteValue(value);
  if (finite === null) {
    return NO_DATA;
  }

  const decimals = normalizeDecimals(opts?.decimals, 2);
  const formatted = getNumberFormatter(decimals).format(finite);
  return withSign(finite, formatted, opts?.sign === true);
}

export function formatCompact(
  value: number,
  opts?: { decimals?: number; prefix?: string },
): string {
  const finite = toFiniteValue(value);
  if (finite === null) {
    return NO_DATA;
  }

  const decimals = normalizeDecimals(opts?.decimals, 1);
  const formatter = getCompactFormatter(decimals);
  const prefix = opts?.prefix ?? '';

  if (!prefix) {
    return formatter.format(finite);
  }

  const absFormatted = formatter.format(Math.abs(finite));
  return finite < 0 ? `-${prefix}${absFormatted}` : `${prefix}${absFormatted}`;
}

export function formatBasisPoints(value: number): string {
  const finite = toFiniteValue(value);
  if (finite === null) {
    return NO_DATA;
  }

  const basisPoints = roundTo(finite * 10000, 0);
  return `${getNumberFormatter(0).format(basisPoints)} bp`;
}

export function formatSharpeRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const finite = value as number;
  const normalized = Object.is(finite, -0) ? 0 : finite;
  return normalized.toFixed(2);
}

export function roundTo(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }

  const normalized = normalizeNegativeZero(value);
  const safeDecimals = normalizeDecimals(decimals, 2);
  const shifted = Number(`${normalized}e${safeDecimals}`);
  const rounded = Number(`${Math.round(shifted)}e-${safeDecimals}`);
  return normalizeNegativeZero(rounded);
}
