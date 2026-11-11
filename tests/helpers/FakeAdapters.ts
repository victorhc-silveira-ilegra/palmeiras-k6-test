import { ClockPort } from '../../src/application/ports/ClockPort.ts';
import { EventLoggerPort, LogLevel } from '../../src/application/ports/EventLoggerPort.ts';
import {
  HttpTransportPort,
  TransportRequest,
  TransportResponse,
} from '../../src/application/ports/HttpTransportPort.ts';
import {
  CheckEvaluatorMap,
  MetricsRecorderPort,
} from '../../src/application/ports/MetricsRecorderPort.ts';

export interface LoggedEvent {
  level: LogLevel;
  event: string;
  fields: Record<string, unknown> | undefined;
}

export class InMemoryEventLogger implements EventLoggerPort {
  public readonly events: LoggedEvent[] = [];

  public emit(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    this.events.push({ level, event, fields });
  }
}

export class SpyMetricsRecorder implements MetricsRecorderPort {
  public cacheHits: boolean[] = [];
  public dynamicDurations: number[] = [];
  public wpRestDurations: number[] = [];
  public wpSearchDurations: number[] = [];
  public journeyDurations: number[] = [];
  public deadlocks = 0;
  public rateLimits = 0;
  public prodRedirects = 0;
  public phpFatals = 0;
  public phpWarningLeaks = 0;
  public jsonRecords = 0;
  public known500Regressions = 0;
  public checksHistory: Record<string, boolean>[] = [];

  public recordCacheHit(hit: boolean): void {
    this.cacheHits.push(hit);
  }

  public recordDynamicQueryDuration(durationMs: number): void {
    this.dynamicDurations.push(durationMs);
  }

  public recordWpRestDuration(durationMs: number): void {
    this.wpRestDurations.push(durationMs);
  }

  public recordWpSearchDuration(durationMs: number): void {
    this.wpSearchDurations.push(durationMs);
  }

  public recordJourneyProcessingDuration(durationMs: number): void {
    this.journeyDurations.push(durationMs);
  }

  public incrementDeadlock(): void {
    this.deadlocks += 1;
  }

  public incrementRateLimit(): void {
    this.rateLimits += 1;
  }

  public incrementProdRedirect(): void {
    this.prodRedirects += 1;
  }

  public incrementPhpFatal(): void {
    this.phpFatals += 1;
  }

  public incrementPhpWarningLeak(): void {
    this.phpWarningLeaks += 1;
  }

  public incrementJsonRecordsProcessed(count: number): void {
    this.jsonRecords += count;
  }

  public incrementKnown500Regression(): void {
    this.known500Regressions += 1;
  }

  public recordChecks(_res: TransportResponse, checks: CheckEvaluatorMap): boolean {
    const evaluated: Record<string, boolean> = {};
    let allPassed = true;
    for (const [name, fn] of Object.entries(checks)) {
      const ok = fn();
      evaluated[name] = ok;
      if (!ok) {
        allPassed = false;
      }
    }
    this.checksHistory.push(evaluated);
    return allPassed;
  }
}

export class StubHttpTransport implements HttpTransportPort {
  public readonly requests: TransportRequest[] = [];
  private readonly responder: (req: TransportRequest) => TransportResponse;

  public constructor(responder: (req: TransportRequest) => TransportResponse) {
    this.responder = responder;
  }

  public request(req: TransportRequest): TransportResponse {
    this.requests.push(req);
    return this.responder(req);
  }
}

export class FixedClock implements ClockPort {
  private currentMs: number;
  private readonly fixedRandom: number;

  public constructor(startMs = 1_700_000_000_000, fixedRandom = 0.2) {
    this.currentMs = startMs;
    this.fixedRandom = fixedRandom;
  }

  public nowMs(): number {
    this.currentMs += 10;
    return this.currentMs;
  }

  public random(): number {
    return this.fixedRandom;
  }
}
