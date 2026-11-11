export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface EventLoggerPort {
  emit(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
}
