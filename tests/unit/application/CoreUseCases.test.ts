import { describe, expect, it } from 'vitest';
import { ForbiddenProductionTargetError } from '../../../src/domain/errors/DomainError.ts';
import { EvaluateResponseUseCase } from '../../../src/application/use_cases/EvaluateResponseUseCase.ts';
import { ResolveEnvironmentUseCase } from '../../../src/application/use_cases/ResolveEnvironmentUseCase.ts';
import { InMemoryEventLogger, SpyMetricsRecorder } from '../../helpers/FakeAdapters.ts';

describe('ResolveEnvironmentUseCase', () => {
  it('resolve ambiente HML valido e bloqueia PROD', () => {
    const useCase = new ResolveEnvironmentUseCase();
    const env = useCase.execute('hml_classic_elb');
    expect(env.name).toBe('hml_classic_elb');
    expect(() => useCase.execute('prod_alb')).toThrow(ForbiddenProductionTargetError);
  });
});

describe('EvaluateResponseUseCase', () => {
  it('registra metricas e emite eventos semanticos apenas quando aplicavel', () => {
    const metrics = new SpyMetricsRecorder();
    const logger = new InMemoryEventLogger();
    const useCase = new EvaluateResponseUseCase(metrics, logger);

    useCase.evaluateAndRecord({
      response: { status: 302, body: '', headers: { Location: 'https://www.palmeiras.com.br/' }, durationMs: 42 },
      routeName: 'root_redirect',
      allowKnownHomologRedirect: false,
      allowKnown500: false,
    });
    expect(metrics.prodRedirects).toBe(1);
    expect(logger.events[0]?.event).toBe('k6.guardrail.prod_blocked');

    useCase.evaluateAndRecord({
      response: {
        status: 429,
        body: 'limit',
        headers: { 'X-FastCGI-Cache': 'BYPASS' },
        durationMs: 12,
      },
      routeName: 'rate_test',
      vu: 3,
      iter: 2,
    });
    expect(metrics.rateLimits).toBe(1);
    expect(logger.events[1]?.event).toBe('k6.response.rate_limited');
    expect(logger.events[1]?.fields?.cache).toBe('BYPASS');

    useCase.evaluateAndRecord({
      response: {
        status: 500,
        body: 'Fatal error: Deadlock found',
        headers: { 'X-Cache': 'MISS' },
        durationMs: 120,
      },
      routeName: 'db_deadlock',
    });
    expect(metrics.phpFatals).toBe(1);
    expect(metrics.deadlocks).toBe(1);
    expect(logger.events[2]?.event).toBe('k6.response.php_fatal');
    expect(logger.events[2]?.fields?.cache).toBe('MISS');

    useCase.evaluateAndRecord({
      response: { status: 502, body: 'Bad Gateway', headers: { Age: '5' }, durationMs: 500 },
      routeName: 'bad_gw',
    });
    expect(logger.events[3]?.event).toBe('k6.response.transport_error');
    expect(logger.events[3]?.fields?.cache).toBe('5');

    const okResult = useCase.evaluateAndRecord({
      response: { status: 200, body: 'ok', headers: { 'X-Cache': 'HIT' }, durationMs: 10 },
      routeName: 'healthcheck',
    });
    expect(okResult.shouldLogFailure).toBe(false);
    expect(logger.events).toHaveLength(4);
  });

  it('extrai WP JSON registrando warning leak e contagem de registros', () => {
    const metrics = new SpyMetricsRecorder();
    const logger = new InMemoryEventLogger();
    const useCase = new EvaluateResponseUseCase(metrics, logger);

    const parsed = useCase.parseWpJsonAndRecord<Array<{ id: number }>>(
      {
        status: 200,
        body: '<b>Warning</b>: test<br />\n[{"id":10},{"id":20}]',
        headers: {},
        durationMs: 25,
      },
      'wp_posts'
    );
    expect(parsed).toEqual([{ id: 10 }, { id: 20 }]);
    expect(metrics.phpWarningLeaks).toBe(1);
    expect(metrics.jsonRecords).toBe(2);
    expect(logger.events[0]?.event).toBe('k6.response.php_warning_stripped');

    const empty = useCase.parseWpJsonAndRecord(
      { status: 204, body: '', headers: {}, durationMs: 5 },
      'empty_resp'
    );
    expect(empty).toBeNull();
  });
});
