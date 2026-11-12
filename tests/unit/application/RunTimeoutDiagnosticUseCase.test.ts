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

interface DiagnosticContext {
  env: TargetEnvironment;
  metrics: SpyMetricsRecorder;
  logger: InMemoryEventLogger;
  clock: FixedClock;
  evaluator: EvaluateResponseUseCase;
  transport: StubHttpTransport;
  client: HttpRouteClient;
  useCase: RunTimeoutDiagnosticUseCase;
}

const setupDiagnostic = (
  envName: 'azion_edge' | 'hml_ec2_direct' | 'hml_alb' | 'hml_classic_elb' | 'ec2_direct',
  handler: (req: { method: string; url: string; headers: Record<string, string>; body?: string }) => {
    status: number;
    body: string;
    headers: Record<string, string>;
    durationMs: number;
  }
): DiagnosticContext => {
  const env = TargetEnvironment.fromName(envName);
  const metrics = new SpyMetricsRecorder();
  const logger = new InMemoryEventLogger();
  const clock = new FixedClock();
  const evaluator = new EvaluateResponseUseCase(metrics, logger);
  const transport = new StubHttpTransport(handler);
  const client = new HttpRouteClient(env, transport, metrics, evaluator);
  const useCase = new RunTimeoutDiagnosticUseCase(env, client, clock, metrics, logger);
  return { env, metrics, logger, clock, evaluator, transport, client, useCase };
};

describe('RunTimeoutDiagnosticUseCase', () => {
  it('executa wp-admin e admin-ajax autenticados e detecta slow_ttfb e session lock pos-504', () => {
    const { metrics, logger, transport, useCase } = setupDiagnostic('hml_ec2_direct', (req) => {
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
    const { metrics, transport, useCase } = setupDiagnostic('azion_edge', (req) => {
      if (req.url.includes('/wp-admin/admin-ajax.php')) {
        return { status: 0, body: '', headers: {}, durationMs: 500 };
      }
      return { status: 200, body: '[]', headers: {}, durationMs: 100 };
    });

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
    const { metrics, logger, useCase } = setupDiagnostic('hml_ec2_direct', (req) => {
      if (req.url.includes('/wp-admin/admin-ajax.php')) {
        return { status: 200, body: 'ok', headers: {}, durationMs: 65_000 };
      }
      if (req.url.includes('_lock_')) {
        return { status: 200, body: '[]', headers: {}, durationMs: 5_000 };
      }
      return { status: 200, body: '[]', headers: {}, durationMs: 100 };
    });

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
    const { logger, transport, useCase } = setupDiagnostic('hml_ec2_direct', () => ({
      status: 200,
      body: '{"success":true}',
      headers: {},
      durationMs: 70_000,
    }));

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
    const { transport, useCase } = setupDiagnostic('azion_edge', () => ({
      status: 200,
      body: 'HTML content',
      headers: {},
      durationMs: 1_200,
    }));

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
    const { metrics, transport, useCase } = setupDiagnostic('azion_edge', () => ({
      status: 504,
      body: 'Gateway Timeout',
      headers: {},
      durationMs: 300_000,
    }));

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

  it('executa probeHeavySynchronousAction para VU 2 vitima de concorrencia com bloqueio e sem bloqueio', () => {
    let callCount = 0;
    const { metrics, logger, useCase } = setupDiagnostic('azion_edge', () => {
      callCount += 1;
      return callCount === 1
        ? { status: 504, body: 'Locked', headers: {}, durationMs: 15_000 }
        : { status: 200, body: 'OK', headers: {}, durationMs: 200 };
    });

    const victimBlocked = useCase.probeHeavySynchronousAction(
      '/wp-admin/update-core.php',
      {
        authCookie: 'wp_session_token=xyz',
        wpNonce: '',
        ajaxAction: 'heartbeat',
        adminPath: '/wp-admin/',
      },
      2,
      0
    );

    expect(victimBlocked.status).toBe(504);
    expect(metrics.post504SessionBlocks).toBe(1);
    expect(logger.events.some((e) => e.event === 'k6.session.lock_detected')).toBe(true);

    const victimOk = useCase.probeHeavySynchronousAction(
      '/wp-admin/update-core.php',
      {
        authCookie: '',
        wpNonce: '',
        ajaxAction: 'heartbeat',
        adminPath: '/wp-admin/',
      },
      2,
      1
    );

    expect(victimOk.status).toBe(200);
    expect(metrics.post504SessionBlocks).toBe(1);
  });

  it('diferencia edge transport drop (status 0) de gateway timeout 504 para VU 1', () => {
    let currentStatus = 0;
    const { metrics, useCase } = setupDiagnostic('azion_edge', () => ({
      status: currentStatus,
      body: currentStatus === 0 ? '' : '504 Timeout',
      headers: {},
      durationMs: 500,
    }));

    const dropRes = useCase.probeHeavySynchronousAction(
      '/wp-admin/update-core.php',
      { authCookie: '', wpNonce: '', ajaxAction: '', adminPath: '/wp-admin/' },
      1,
      0
    );
    expect(dropRes.status).toBe(0);
    expect(metrics.edgeTransportDrops).toBe(1);
    expect(metrics.gatewayTimeouts504).toBe(0);

    currentStatus = 504;
    const timeoutRes = useCase.probeHeavySynchronousAction(
      '/wp-admin/update-core.php',
      { authCookie: '', wpNonce: '', ajaxAction: '', adminPath: '/wp-admin/' },
      1,
      1
    );
    expect(timeoutRes.status).toBe(504);
    expect(metrics.edgeTransportDrops).toBe(1);
    expect(metrics.gatewayTimeouts504).toBe(1);
  });
});
