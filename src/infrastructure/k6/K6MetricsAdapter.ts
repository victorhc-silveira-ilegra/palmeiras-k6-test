import { TransportResponse } from '../../application/ports/HttpTransportPort.ts';
import {
  CheckEvaluatorMap,
  MetricsRecorderPort,
} from '../../application/ports/MetricsRecorderPort.ts';
import { Checkers } from 'k6';

export interface MetricSink {
  add(value: number): void;
}

export interface K6MetricBindings {
  cacheHitRate: MetricSink;
  dynamicQueryDuration: MetricSink;
  wpRestDuration: MetricSink;
  wpSearchDuration: MetricSink;
  journeyProcessingDuration: MetricSink;
  deadlocksCounter: MetricSink;
  rateLimitHitCounter: MetricSink;
  prodRedirectBlockedCounter: MetricSink;
  phpFatalDetectedCounter: MetricSink;
  phpWarningLeakCounter: MetricSink;
  jsonRecordsProcessedCounter: MetricSink;
  known500RegressionCounter: MetricSink;
  gatewayTimeout504Counter: MetricSink;
  edgeTransportDropCounter: MetricSink;
  post504SessionBlockedCounter: MetricSink;
  upstreamTtfbDuration: MetricSink;
  checkFn: <T>(val: T, sets: Checkers<T>) => boolean;
}

export class K6MetricsAdapter implements MetricsRecorderPort {
  private readonly bindings: K6MetricBindings;

  public constructor(bindings: K6MetricBindings) {
    this.bindings = bindings;
  }

  public recordCacheHit(hit: boolean): void {
    this.bindings.cacheHitRate.add(hit ? 1 : 0);
  }

  public recordDynamicQueryDuration(durationMs: number): void {
    this.bindings.dynamicQueryDuration.add(durationMs);
  }

  public recordWpRestDuration(durationMs: number): void {
    this.bindings.wpRestDuration.add(durationMs);
  }

  public recordWpSearchDuration(durationMs: number): void {
    this.bindings.wpSearchDuration.add(durationMs);
  }

  public recordJourneyProcessingDuration(durationMs: number): void {
    this.bindings.journeyProcessingDuration.add(durationMs);
  }

  public incrementDeadlock(): void {
    this.bindings.deadlocksCounter.add(1);
  }

  public incrementRateLimit(): void {
    this.bindings.rateLimitHitCounter.add(1);
  }

  public incrementProdRedirect(): void {
    this.bindings.prodRedirectBlockedCounter.add(1);
  }

  public incrementPhpFatal(): void {
    this.bindings.phpFatalDetectedCounter.add(1);
  }

  public incrementPhpWarningLeak(): void {
    this.bindings.phpWarningLeakCounter.add(1);
  }

  public incrementJsonRecordsProcessed(count: number): void {
    this.bindings.jsonRecordsProcessedCounter.add(count);
  }

  public incrementKnown500Regression(): void {
    this.bindings.known500RegressionCounter.add(1);
  }

  public incrementGatewayTimeout504(): void {
    this.bindings.gatewayTimeout504Counter.add(1);
  }

  public incrementEdgeTransportDrop(): void {
    this.bindings.edgeTransportDropCounter.add(1);
  }

  public incrementPost504SessionBlocked(): void {
    this.bindings.post504SessionBlockedCounter.add(1);
  }

  public recordUpstreamTtfbDuration(durationMs: number): void {
    this.bindings.upstreamTtfbDuration.add(durationMs);
  }

  public recordChecks(res: TransportResponse, checks: CheckEvaluatorMap): boolean {
    const k6Checks: Checkers<TransportResponse> = {};
    for (const [label, fn] of Object.entries(checks)) {
      k6Checks[label] = (): boolean => fn();
    }
    return this.bindings.checkFn(res, k6Checks);
  }
}
