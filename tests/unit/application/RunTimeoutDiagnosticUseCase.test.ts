import { describe, expect, it } from 'vitest';
import { EvaluateResponseUseCase } from '../../../src/application/use_cases/EvaluateResponseUseCase.ts';
import { HttpRouteClient } from '../../../src/application/use_cases/HttpRouteClient.ts';
import { RunTimeoutDiagnosticUseCase } from '../../../src/application/use_cases/RunTimeoutDiagnosticUseCase.ts';
import { TargetEnvironment } from '../../../src/domain/value_objects/TargetEnvironment.ts';
import {
  FixedClock,
  InMemoryEventLogger,
  SpyMetricsRecorder,
  StubHttpTransport,
} from '../../helpers/FakeAdapters.ts';

describe('RunTimeoutDiagnosticUseCase', () => {
  it('executa wp-admin e admin-ajax autenticados e detecta slow_ttfb e session lock pos-504', () => {
    const env = TargetEnvironment.fromName('hml_ec2_direct');
    const metrics = new SpyMetricsRecorder();
    const logger = new InMemoryEventLogger();
    const clock = new FixedClock();
    const evaluator = new EvaluateResponseUseCase(metrics, logger);

    const transport = new StubHttpTransport((req) => {
      if (req.url.includes('/wp-admin/admin-ajax.php')) {
        return { status: 504, body: '504 Gateway Time-out', headers: {}, durationMs: 180_000 };
      }
      if (req.url.includes('/wp-admin/')) {
        return { status: 200, body: 'Dashboard', headers: {}, durationMs: 65_000 };
      }
      if (req.url.includes('_lock_')) {
        return { status: 504, body: 'blocked', headers: {}, durationMs: 10_000 };
      }
      return { status: 200, body: '[]', headers: {}, durationMs: 150 };
    });

    const client = new HttpRouteClient(env, transport, metrics, evaluator);
    const useCase = new RunTimeoutDiagnosticUseCase(env, client, clock, metrics, logger);

    const result = useCase.probeSessionLockContention(
      {
        authCookie: 'wordpress_logged_in=hml_token',
        wpNonce: 'abc123',
        ajaxAction: 'update-plugin',
        adminPath: '/wp-admin/plugins.php',
      },
      1,
      0
    );

    expect(result.primary.status).toBe(504);
    expect(result.followUp.status).toBe(504);
    expect(result.cleanControl.status).toBe(200);
    expect(metrics.gatewayTimeouts504).toBe(2);
    expect(metrics.post504SessionBlocks).toBe(1);
    expect(logger.events.some((e) => e.event === 'k6.timeout.slow_ttfb')).toBe(true);
    expect(logger.events.some((e) => e.event === 'k6.session.lock_detected')).toBe(true);
    expect(transport.requests[0]?.headers.Host).toBe('hmlverdao.palmeiras.com.br');
    expect(transport.requests[0]?.headers.Cookie).toBe('wordpress_logged_in=hml_token');
    expect(transport.requests[1]?.body).toContain('_ajax_nonce=abc123');
  });

  it('funciona sem cookie/nonce e detecta edge drop (status 0) sem falso positivo de lock', () => {
    const env = TargetEnvironment.fromName('azion_edge');
    const metrics = new SpyMetricsRecorder();
    const logger = new InMemoryEventLogger();
    const clock = new FixedClock();
    const evaluator = new EvaluateResponseUseCase(metrics, logger);

    const transport = new StubHttpTransport((req) => {
      if (req.url.includes('/wp-admin/admin-ajax.php')) {
        return { status: 0, body: '', headers: {}, durationMs: 500 };
      }
      return { status: 200, body: '[]', headers: {}, durationMs: 100 };
    });

    const client = new HttpRouteClient(env, transport, metrics, evaluator);
    const useCase = new RunTimeoutDiagnosticUseCase(env, client, clock, metrics, logger);

    const result = useCase.probeSessionLockContention({
      authCookie: '',
      wpNonce: '',
      ajaxAction: 'heartbeat',
      adminPath: '/wp-admin/',
    });

    expect(result.primary.status).toBe(0);
    expect(result.followUp.status).toBe(200);
    expect(metrics.edgeTransportDrops).toBe(1);
    expect(metrics.post504SessionBlocks).toBe(0);
    expect(transport.requests[0]?.headers.Cookie).toBeUndefined();
    expect(transport.requests[0]?.body).not.toContain('_ajax_nonce');
  });

  it('detecta lock por lentidao prolongada (>=60s) com degradacao no followup', () => {
    const env = TargetEnvironment.fromName('hml_ec2_direct');
    const metrics = new SpyMetricsRecorder();
    const logger = new InMemoryEventLogger();
    const clock = new FixedClock();
    const evaluator = new EvaluateResponseUseCase(metrics, logger);

    const transport = new StubHttpTransport((req) => {
      if (req.url.includes('/wp-admin/admin-ajax.php')) {
        return { status: 200, body: 'ok', headers: {}, durationMs: 65_000 };
      }
      if (req.url.includes('_lock_')) {
        return { status: 200, body: '[]', headers: {}, durationMs: 5_000 };
      }
      return { status: 200, body: '[]', headers: {}, durationMs: 100 };
    });

    const client = new HttpRouteClient(env, transport, metrics, evaluator);
    const useCase = new RunTimeoutDiagnosticUseCase(env, client, clock, metrics, logger);

    const result = useCase.probeSessionLockContention({
      authCookie: '',
      wpNonce: '',
      ajaxAction: 'heartbeat',
      adminPath: '/wp-admin/',
    });

    expect(result.primary.status).toBe(200);
    expect(metrics.post504SessionBlocks).toBe(1);
    expect(logger.events.some((e) => e.event === 'k6.session.lock_detected')).toBe(true);
  });

  it('executa probeHeavySynchronousAction com POST e valida headers e checks', () => {
    const env = TargetEnvironment.fromName('hml_ec2_direct');
    const metrics = new SpyMetricsRecorder();
    const logger = new InMemoryEventLogger();
    const clock = new FixedClock();
    const evaluator = new EvaluateResponseUseCase(metrics, logger);

    const transport = new StubHttpTransport(() => ({
      status: 200,
      body: '{"success":true}',
      headers: {},
      durationMs: 70_000,
    }));

    const client = new HttpRouteClient(env, transport, metrics, evaluator);
    const useCase = new RunTimeoutDiagnosticUseCase(env, client, clock, metrics, logger);

    const res = useCase.probeHeavySynchronousAction(
      '/wp-admin/admin-ajax.php',
      {
        authCookie: 'wp_test=123',
        wpNonce: 'nonce456',
        ajaxAction: 'heavy-update',
        adminPath: '/wp-admin/',
      },
      1,
      0
    );

    expect(res.status).toBe(200);
    expect(transport.requests[0]?.method).toBe('POST');
    expect(transport.requests[0]?.body).toContain('action=heavy-update');
    expect(transport.requests[0]?.body).toContain('_ajax_nonce=nonce456');
    expect(transport.requests[0]?.headers.Cookie).toBe('wp_test=123');
    expect(logger.events.some((e) => e.event === 'k6.timeout.slow_ttfb')).toBe(true);
  });

  it('executa probeHeavySynchronousAction com GET para rota pesada sem body', () => {
    const env = TargetEnvironment.fromName('azion_edge');
    const metrics = new SpyMetricsRecorder();
    const logger = new InMemoryEventLogger();
    const clock = new FixedClock();
    const evaluator = new EvaluateResponseUseCase(metrics, logger);

    const transport = new StubHttpTransport(() => ({
      status: 200,
      body: 'HTML content',
      headers: {},
      durationMs: 1_200,
    }));

    const client = new HttpRouteClient(env, transport, metrics, evaluator);
    const useCase = new RunTimeoutDiagnosticUseCase(env, client, clock, metrics, logger);

    const res = useCase.probeHeavySynchronousAction('/wp-admin/plugins.php?page=heavy', {
      authCookie: '',
      wpNonce: '',
      ajaxAction: '',
      adminPath: '/wp-admin/',
    });

    expect(res.status).toBe(200);
    expect(transport.requests[0]?.method).toBe('GET');
    expect(transport.requests[0]?.url).toContain('heavy_probe=');
    expect(transport.requests[0]?.body).toBeUndefined();
  });

  it('executa probeHeavySynchronousAction com rota sem query string e detecta falha 504/0', () => {
    const env = TargetEnvironment.fromName('azion_edge');
    const metrics = new SpyMetricsRecorder();
    const logger = new InMemoryEventLogger();
    const clock = new FixedClock();
    const evaluator = new EvaluateResponseUseCase(metrics, logger);

    const transport = new StubHttpTransport(() => ({
      status: 504,
      body: 'Gateway Timeout',
      headers: {},
      durationMs: 300_000,
    }));

    const client = new HttpRouteClient(env, transport, metrics, evaluator);
    const useCase = new RunTimeoutDiagnosticUseCase(env, client, clock, metrics, logger);

    const res = useCase.probeHeavySynchronousAction('/wp-admin/tools.php', {
      authCookie: '',
      wpNonce: '',
      ajaxAction: '',
      adminPath: '/wp-admin/',
    });

    expect(res.status).toBe(504);
    expect(transport.requests[0]?.url).toContain('/wp-admin/tools.php?heavy_probe=');
    const lastCheck = metrics.checksHistory[metrics.checksHistory.length - 1];
    expect(lastCheck?.['Ação Pesada: completou sem 504 Gateway Timeout']).toBe(false);
    expect(lastCheck?.['Ação Pesada: conexão não foi abortada prematuramente']).toBe(true);
  });
});
