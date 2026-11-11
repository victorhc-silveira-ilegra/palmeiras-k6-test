import { HttpMethod } from '../../domain/entities/JourneyModels.ts';
import { TargetEnvironment } from '../../domain/value_objects/TargetEnvironment.ts';
import {
  HttpTransportPort,
  TransportRequest,
  TransportResponse,
} from '../ports/HttpTransportPort.ts';
import { MetricsRecorderPort } from '../ports/MetricsRecorderPort.ts';
import { EvaluateResponseUseCase } from './EvaluateResponseUseCase.ts';

export type DurationMetricKind = 'wp_rest' | 'wp_search' | 'dynamic' | 'none';

export interface RouteCallOptions {
  method?: HttpMethod;
  path: string;
  tags: Record<string, string>;
  routeName: string;
  body?: string;
  extraHeaders?: Record<string, string>;
  timeout?: string;
  expectedStatuses?: number[];
  allowKnownHomologRedirect?: boolean;
  allowKnown500?: boolean;
  recordCache?: boolean;
  durationMetric?: DurationMetricKind;
}

export class HttpRouteClient {
  private readonly env: TargetEnvironment;
  private readonly transport: HttpTransportPort;
  private readonly metrics: MetricsRecorderPort;
  private readonly evaluator: EvaluateResponseUseCase;

  public constructor(
    env: TargetEnvironment,
    transport: HttpTransportPort,
    metrics: MetricsRecorderPort,
    evaluator: EvaluateResponseUseCase
  ) {
    this.env = env;
    this.transport = transport;
    this.metrics = metrics;
    this.evaluator = evaluator;
  }

  public execute(opts: RouteCallOptions): TransportResponse {
    const req: TransportRequest = {
      method: opts.method ?? 'GET',
      url: `${this.env.baseUrl}${opts.path}`,
      headers: {
        Host: this.env.hostHeader,
        'X-Forwarded-Proto': 'https',
        'User-Agent': 'palmeiras-k6-hml/2.0',
        Accept: 'application/json, text/html;q=0.9,*/*;q=0.8',
        ...(opts.extraHeaders ?? {}),
      },
      timeout: opts.timeout ?? this.env.timeout,
      tags: opts.tags,
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(opts.expectedStatuses !== undefined
        ? { expectedStatuses: opts.expectedStatuses }
        : {}),
    };

    const res = this.transport.request(req);
    this.recordDuration(opts.durationMetric ?? 'none', res.durationMs);

    const evaluation = this.evaluator.evaluateAndRecord({
      response: res,
      routeName: opts.routeName,
      allowKnownHomologRedirect: opts.allowKnownHomologRedirect ?? false,
      allowKnown500: opts.allowKnown500 ?? false,
    });

    if (opts.recordCache) {
      this.metrics.recordCacheHit(evaluation.cacheHit);
    }

    return res;
  }

  public parseJson<T = unknown>(res: TransportResponse, routeName: string): T | null {
    return this.evaluator.parseWpJsonAndRecord<T>(res, routeName);
  }

  private recordDuration(kind: DurationMetricKind, durationMs: number): void {
    switch (kind) {
      case 'wp_rest':
        this.metrics.recordWpRestDuration(durationMs);
        break;
      case 'wp_search':
        this.metrics.recordWpSearchDuration(durationMs);
        break;
      case 'dynamic':
        this.metrics.recordDynamicQueryDuration(durationMs);
        break;
      default:
        break;
    }
  }
}
