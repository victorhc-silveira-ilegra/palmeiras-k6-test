import {
  HeaderMap,
  SafetyEvaluationInput,
  SafetyEvaluationResult,
} from '../entities/JourneyModels.ts';

const PROD_REDIRECT_RX = /www\.palmeiras\.com\.br|prod-site-azion/i;
const PHP_OR_DB_ERROR_RX =
  /Fatal error|Parse error|Uncaught Error|Error establishing a database connection|Deadlock found/i;
const PHP_WARNING_PREFIX_RX =
  /^(?:(?:<br\s*\/?>)?\s*\n?\s*<b>(?:Warning|Notice|Deprecated)<\/b>:[\s\S]*?<br\s*\/?>\s*\n?)+/i;

export interface ParsedWpJsonResult<T> {
  data: T | null;
  warningLeaked: boolean;
  recordCount: number;
}

export function getHeaderCaseInsensitive(headers: HeaderMap, name: string): string {
  const direct = headers[name];
  if (direct !== undefined) {
    return direct;
  }
  const lowerTarget = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerTarget && value !== undefined) {
      return value;
    }
  }
  return '';
}

export function isProdRedirectLocation(location: string): boolean {
  return PROD_REDIRECT_RX.test(location);
}

export function detectCacheHit(headers: HeaderMap): boolean {
  const fastcgi = getHeaderCaseInsensitive(headers, 'X-FastCGI-Cache').toUpperCase();
  const xCache = getHeaderCaseInsensitive(headers, 'X-Cache').toUpperCase();
  const age = Number(getHeaderCaseInsensitive(headers, 'Age') || 0);
  return fastcgi === 'HIT' || xCache.includes('HIT') || age > 0;
}

function resolveJsonPayloadStart(clean: string): string | null {
  const objIdx = clean.indexOf('{');
  const arrIdx = clean.indexOf('[');
  const candidates = [objIdx, arrIdx].filter((idx) => idx >= 0);
  if (candidates.length === 0) {
    return null;
  }
  return clean.slice(Math.min(...candidates));
}

function countJsonRecords(parsed: unknown): number {
  if (Array.isArray(parsed)) {
    return parsed.length;
  }
  if (parsed !== null && typeof parsed === 'object') {
    return 1;
  }
  return 0;
}

export function extractPhpWarningFreeJson<T = unknown>(body: string): ParsedWpJsonResult<T> {
  let clean = body.trim();
  if (!clean) {
    return { data: null, warningLeaked: false, recordCount: 0 };
  }

  let warningLeaked = false;
  if (PHP_WARNING_PREFIX_RX.test(clean)) {
    warningLeaked = true;
    const stripped = resolveJsonPayloadStart(clean);
    if (stripped === null) {
      return { data: null, warningLeaked: true, recordCount: 0 };
    }
    clean = stripped;
  }

  try {
    const parsed = JSON.parse(clean) as T;
    return {
      data: parsed,
      warningLeaked,
      recordCount: countJsonRecords(parsed),
    };
  } catch {
    return { data: null, warningLeaked, recordCount: 0 };
  }
}

export function evaluateResponseSafety(input: SafetyEvaluationInput): SafetyEvaluationResult {
  const location = getHeaderCaseInsensitive(input.headers, 'Location');
  const pointsToProd = isProdRedirectLocation(location);
  const rateLimited = input.status === 429;
  const hasPhpOrDbError = PHP_OR_DB_ERROR_RX.test(input.body);
  const hasDeadlock = hasPhpOrDbError && input.body.includes('Deadlock found');
  const serverErrorOrTransportFailure = input.status >= 500 || input.status === 0;
  const cacheHit = detectCacheHit(input.headers);
  const noProdRedirectPassed = input.allowKnownHomologRedirect || !pointsToProd;

  let failureReason = '';
  if (pointsToProd && !input.allowKnownHomologRedirect) {
    failureReason = 'Redirect para PROD detectado';
  } else if (rateLimited) {
    failureReason = 'Rate limit 429';
  } else if (hasPhpOrDbError && !input.allowKnown500) {
    failureReason = 'Erro PHP/DB detectado no body';
  } else if (serverErrorOrTransportFailure && !input.allowKnown500) {
    failureReason = 'Status 5xx ou erro de transporte';
  }

  return {
    location,
    pointsToProd,
    noProdRedirectPassed,
    rateLimited,
    hasPhpOrDbError,
    hasDeadlock,
    serverErrorOrTransportFailure,
    cacheHit,
    shouldLogFailure: failureReason !== '',
    failureReason,
  };
}
