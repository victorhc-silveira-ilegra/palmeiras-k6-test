import { EventLoggerPort, LogLevel } from '../../application/ports/EventLoggerPort.ts';

export interface LogSink {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LoggerOptions {
  minLevel?: LogLevel;
  logErrors?: boolean;
  sampleRate?: number;
  nowIso?: () => string;
  random?: () => number;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

const SENSITIVE_KEY_RX = /authorization|cookie|token|secret|password|passwd|api[-_]?key/i;
const SENSITIVE_INLINE_RX = /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi;
const SENSITIVE_QUERY_RX = /([?&](?:token|key|secret|password)=)[^&\s]+/gi;
const MAX_STRING_LENGTH = 256;

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const masked = value
      .replace(SENSITIVE_INLINE_RX, '$1[REDACTED]')
      .replace(SENSITIVE_QUERY_RX, '$1[REDACTED]');
    if (masked.length > MAX_STRING_LENGTH) {
      return `${masked.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`;
    }
    return masked;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeLogFields(value as Record<string, unknown>);
  }
  return value;
}

export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    sanitized[key] = SENSITIVE_KEY_RX.test(key) ? '[REDACTED]' : sanitizeValue(value);
  }
  return sanitized;
}

export function logEvent(
  sink: LogSink,
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
  options: LoggerOptions = {}
): void {
  const minLevel = options.minLevel ?? 'INFO';
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) {
    return;
  }
  const isErrorLike = level === 'WARN' || level === 'ERROR';
  if (isErrorLike && options.logErrors === false) {
    return;
  }
  const sampleRate = options.sampleRate ?? 1;
  const randomFn = options.random ?? Math.random;
  if (isErrorLike && sampleRate < 1 && randomFn() > sampleRate) {
    return;
  }

  const nowIso = options.nowIso ?? ((): string => new Date().toISOString());
  const payload = JSON.stringify({
    ts: nowIso(),
    level,
    event,
    ...sanitizeLogFields(fields),
  });

  if (level === 'ERROR') {
    sink.error(payload);
    return;
  }
  if (level === 'WARN') {
    sink.warn(payload);
    return;
  }
  sink.info(payload);
}

export class SemanticLoggerAdapter implements EventLoggerPort {
  private readonly sink: LogSink;
  private readonly options: LoggerOptions;

  public constructor(sink: LogSink, options: LoggerOptions = {}) {
    this.sink = sink;
    this.options = options;
  }

  public emit(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    logEvent(this.sink, level, event, fields, this.options);
  }
}
