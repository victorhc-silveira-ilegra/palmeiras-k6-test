import { TransportResponse } from './HttpTransportPort.ts';

export type CheckEvaluatorMap = Record<string, () => boolean>;

export interface MetricsRecorderPort {
  recordCacheHit(hit: boolean): void;
  recordDynamicQueryDuration(durationMs: number): void;
  recordWpRestDuration(durationMs: number): void;
  recordWpSearchDuration(durationMs: number): void;
  recordJourneyProcessingDuration(durationMs: number): void;
  incrementDeadlock(): void;
  incrementRateLimit(): void;
  incrementProdRedirect(): void;
  incrementPhpFatal(): void;
  incrementPhpWarningLeak(): void;
  incrementJsonRecordsProcessed(count: number): void;
  incrementKnown500Regression(): void;
  recordChecks(res: TransportResponse, checks: CheckEvaluatorMap): boolean;
}
