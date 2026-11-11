import { LogLevel } from '../../application/ports/EventLoggerPort.ts';
import { DomainInvariantError } from '../../domain/errors/DomainError.ts';
import { TargetEnvironment } from '../../domain/value_objects/TargetEnvironment.ts';

export type EnvRecord = Record<string, string | undefined>;

export interface RuntimeSettings {
  environment: TargetEnvironment;
  scaleFactor: number;
  rampUp: string;
  hold: string;
  rampDown: string;
  soakVus: number;
  soakDuration: string;
  logLevel: LogLevel;
  logErrors: boolean;
  logErrorSampleRate: number;
  scenarioName: string;
}

const ALLOWED_LOG_LEVELS: readonly LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

function parsePositiveNumber(raw: string | undefined, fallback: number, label: string): number {
  const parsed = raw !== undefined && raw !== '' ? Number(raw) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new DomainInvariantError(`${label} deve ser numero positivo valido.`);
  }
  return parsed;
}

function parseSampleRate(raw: string | undefined): number {
  const parsed = raw !== undefined && raw !== '' ? Number(raw) : 1;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new DomainInvariantError('LOG_ERROR_SAMPLE_RATE deve estar entre 0 e 1.');
  }
  return parsed;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  const upper = (raw || 'INFO').toUpperCase();
  if (!ALLOWED_LOG_LEVELS.includes(upper as LogLevel)) {
    throw new DomainInvariantError(`LOG_LEVEL invalido: "${upper}".`);
  }
  return upper as LogLevel;
}

export function loadSettings(envSource: EnvRecord): RuntimeSettings {
  const targetName = envSource.TARGET_ENV || 'hml_classic_elb';
  const environment = TargetEnvironment.fromName(targetName);

  return {
    environment,
    scaleFactor: parsePositiveNumber(envSource.SCALE_FACTOR, 1, 'SCALE_FACTOR'),
    rampUp: envSource.RAMP_UP || '20s',
    hold: envSource.HOLD || '40s',
    rampDown: envSource.RAMP_DOWN || '15s',
    soakVus: parsePositiveNumber(envSource.SOAK_VUS, 8, 'SOAK_VUS'),
    soakDuration: envSource.SOAK_DURATION || '10m',
    logLevel: parseLogLevel(envSource.LOG_LEVEL),
    logErrors: (envSource.LOG_ERRORS || 'true') === 'true',
    logErrorSampleRate: parseSampleRate(envSource.LOG_ERROR_SAMPLE_RATE),
    scenarioName: envSource.SCENARIO_NAME || 'run',
  };
}
