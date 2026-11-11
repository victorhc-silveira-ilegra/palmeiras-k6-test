import { SafetyEvaluationResult } from '../../domain/entities/JourneyModels.ts';
import {
  evaluateResponseSafety,
  extractPhpWarningFreeJson,
  getHeaderCaseInsensitive,
} from '../../domain/policies/ResponseSafetyPolicy.ts';
import { EventLoggerPort } from '../ports/EventLoggerPort.ts';
import { TransportResponse } from '../ports/HttpTransportPort.ts';
import { MetricsRecorderPort } from '../ports/MetricsRecorderPort.ts';

export interface EvaluateResponseCommand {
  response: TransportResponse;
  routeName: string;
  allowKnownHomologRedirect?: boolean;
  allowKnown500?: boolean;
  vu?: number;
  iter?: number;
}

function resolveSemanticEventName(evaluation: SafetyEvaluationResult): string {
  if (evaluation.pointsToProd) {
    return 'k6.guardrail.prod_blocked';
  }
  if (evaluation.rateLimited) {
    return 'k6.response.rate_limited';
  }
  if (evaluation.hasPhpOrDbError) {
    return 'k6.response.php_fatal';
  }
  return 'k6.response.transport_error';
}

function resolveCacheHeaderLabel(response: TransportResponse): string {
  const fastcgi = getHeaderCaseInsensitive(response.headers, 'X-FastCGI-Cache');
  if (fastcgi) {
    return fastcgi;
  }
  const xCache = getHeaderCaseInsensitive(response.headers, 'X-Cache');
  if (xCache) {
    return xCache;
  }
  const age = getHeaderCaseInsensitive(response.headers, 'Age');
  return age || 'none';
}

export class EvaluateResponseUseCase {
  private readonly metrics: MetricsRecorderPort;
  private readonly logger: EventLoggerPort;

  public constructor(metrics: MetricsRecorderPort, logger: EventLoggerPort) {
    this.metrics = metrics;
    this.logger = logger;
  }

  public evaluateAndRecord(cmd: EvaluateResponseCommand): SafetyEvaluationResult {
    const allowKnownHomologRedirect = cmd.allowKnownHomologRedirect ?? false;
    const allowKnown500 = cmd.allowKnown500 ?? false;
    const evaluation = evaluateResponseSafety({
      status: cmd.response.status,
      headers: cmd.response.headers,
      body: cmd.response.body,
      allowKnownHomologRedirect,
      allowKnown500,
    });

    if (evaluation.pointsToProd) {
      this.metrics.incrementProdRedirect();
    }
    if (evaluation.rateLimited) {
      this.metrics.incrementRateLimit();
    }
    if (evaluation.hasPhpOrDbError) {
      this.metrics.incrementPhpFatal();
    }
    if (evaluation.hasDeadlock) {
      this.metrics.incrementDeadlock();
    }

    if (evaluation.shouldLogFailure) {
      this.logger.emit('WARN', resolveSemanticEventName(evaluation), {
        route: cmd.routeName,
        status: cmd.response.status,
        duration_ms: Math.round(cmd.response.durationMs),
        cache: resolveCacheHeaderLabel(cmd.response),
        location: evaluation.location,
        vu: cmd.vu ?? 0,
        iter: cmd.iter ?? 0,
        reason: evaluation.failureReason,
      });
    }

    this.metrics.recordChecks(cmd.response, {
      no_prod_redirect: () => evaluation.noProdRedirectPassed,
    });

    return evaluation;
  }

  public parseWpJsonAndRecord<T = unknown>(
    response: TransportResponse,
    routeName: string
  ): T | null {
    const parsed = extractPhpWarningFreeJson<T>(response.body);
    if (parsed.warningLeaked) {
      this.metrics.incrementPhpWarningLeak();
      this.logger.emit('DEBUG', 'k6.response.php_warning_stripped', {
        route: routeName,
        status: response.status,
      });
    }
    if (parsed.recordCount > 0) {
      this.metrics.incrementJsonRecordsProcessed(parsed.recordCount);
    }
    return parsed.data;
  }
}
