import { TargetEnvironment } from '../../domain/value_objects/TargetEnvironment.ts';
import { ClockPort } from '../ports/ClockPort.ts';
import { EventLoggerPort } from '../ports/EventLoggerPort.ts';
import { TransportResponse } from '../ports/HttpTransportPort.ts';
import { MetricsRecorderPort } from '../ports/MetricsRecorderPort.ts';
import { HttpRouteClient } from './HttpRouteClient.ts';

export interface TimeoutDiagnosticOptions {
  authCookie: string;
  wpNonce: string;
  ajaxAction: string;
  adminPath: string;
}

export class RunTimeoutDiagnosticUseCase {
  private readonly env: TargetEnvironment;
  private readonly client: HttpRouteClient;
  private readonly clock: ClockPort;
  private readonly metrics: MetricsRecorderPort;
  private readonly logger: EventLoggerPort;

  public constructor(
    env: TargetEnvironment,
    client: HttpRouteClient,
    clock: ClockPort,
    metrics: MetricsRecorderPort,
    logger: EventLoggerPort
  ) {
    this.env = env;
    this.client = client;
    this.clock = clock;
    this.metrics = metrics;
    this.logger = logger;
  }

  public probeAuthenticatedAdminAndAjax(
    opts: TimeoutDiagnosticOptions,
    vu = 0,
    iter = 0
  ): TransportResponse {
    const cookieHeader = opts.authCookie.trim();
    if (cookieHeader) {
      const adminRes = this.client.execute({
        path: opts.adminPath,
        tags: { type: 'wp_admin_probe', route: 'wp_admin_index' },
        routeName: 'wp_admin_index',
        extraHeaders: { Cookie: cookieHeader },
        expectedStatuses: [200, 302],
        allowKnownHomologRedirect: true,
      });
      this.emitSlowTtfbIfExceeded(adminRes, 'wp_admin_index', vu, iter);
      this.metrics.recordChecks(adminRes, {
        'Painel Admin (/wp-admin): respondeu sem 504/queda': () =>
          adminRes.status !== 504 && adminRes.status !== 0,
      });
    }

    const noncePart = opts.wpNonce.trim() ? `&_ajax_nonce=${encodeURIComponent(opts.wpNonce.trim())}` : '';
    const body = `action=${encodeURIComponent(opts.ajaxAction)}${noncePart}&nocache=${this.clock.nowMs()}_${vu}_${iter}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    };
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    const ajaxRes = this.client.execute({
      method: 'POST',
      path: '/wp-admin/admin-ajax.php',
      body,
      extraHeaders: headers,
      tags: { type: 'wp_admin_ajax', route: 'wp_admin_ajax' },
      routeName: 'wp_admin_ajax',
      expectedStatuses: [200, 400],
    });
    this.emitSlowTtfbIfExceeded(ajaxRes, 'wp_admin_ajax', vu, iter);
    this.metrics.recordChecks(ajaxRes, {
      'Admin AJAX (admin-ajax.php): respondeu sem 504/queda': () =>
        ajaxRes.status !== 504 && ajaxRes.status !== 0,
    });
    return ajaxRes;
  }

  public probeSessionLockContention(
    opts: TimeoutDiagnosticOptions,
    vu = 0,
    iter = 0
  ): { primary: TransportResponse; followUp: TransportResponse; cleanControl: TransportResponse } {
    const primary = this.probeAuthenticatedAdminAndAjax(opts, vu, iter);
    const cookieHeader = opts.authCookie.trim();
    const followUpHeaders: Record<string, string> = cookieHeader ? { Cookie: cookieHeader } : {};

    const followUp = this.client.execute({
      path: `/wp-json/wp/v2/posts?per_page=1&nocache=${this.clock.nowMs()}_lock_${vu}_${iter}`,
      extraHeaders: followUpHeaders,
      tags: { type: 'session_lock_probe', route: 'session_followup' },
      routeName: 'session_followup',
      expectedStatuses: [200],
    });

    const cleanControl = this.client.execute({
      path: `/wp-json/wp/v2/posts?per_page=1&nocache=${this.clock.nowMs()}_ctrl_${vu}_${iter}`,
      tags: { type: 'session_lock_probe', route: 'session_clean_control' },
      routeName: 'session_clean_control',
      expectedStatuses: [200],
    });

    const primaryTimedOut = primary.status === 504 || primary.status === 0 || primary.durationMs >= 60_000;
    const followUpBlocked =
      followUp.status === 504 ||
      followUp.status === 0 ||
      followUp.durationMs > cleanControl.durationMs * 3 + 2000;

    if (primaryTimedOut && followUpBlocked) {
      this.metrics.incrementPost504SessionBlocked();
      this.logger.emit('WARN', 'k6.session.lock_detected', {
        env: this.env.name,
        primary_status: primary.status,
        followup_status: followUp.status,
        followup_ms: Math.round(followUp.durationMs),
        control_ms: Math.round(cleanControl.durationMs),
        vu,
        iter,
      });
    }

    this.metrics.recordChecks(followUp, {
      'Sessão pós-504: próxima requisição não travou': () =>
        followUp.status !== 504 && followUp.status !== 0,
    });

    return { primary, followUp, cleanControl };
  }

  public probeHeavySynchronousAction(
    path: string,
    opts: TimeoutDiagnosticOptions,
    vu = 0,
    iter = 0
  ): TransportResponse {
    const cookieHeader = opts.authCookie.trim();
    const headers: Record<string, string> = {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    };
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
    const noncePart = opts.wpNonce.trim() ? `&_ajax_nonce=${encodeURIComponent(opts.wpNonce.trim())}` : '';
    const body = `action=${encodeURIComponent(opts.ajaxAction)}${noncePart}&heavy_sync_probe=${this.clock.nowMs()}_${vu}_${iter}`;
    const isPost = path.includes('admin-ajax.php') || path.includes('update.php');
    if (isPost) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    const targetPath = isPost
      ? path
      : `${path}${path.includes('?') ? '&' : '?'}heavy_probe=${this.clock.nowMs()}_${vu}_${iter}`;

    const res = this.client.execute({
      method: isPost ? 'POST' : 'GET',
      path: targetPath,
      ...(isPost ? { body } : {}),
      extraHeaders: headers,
      tags: { type: 'heavy_sync_probe', route: 'heavy_sync_action' },
      routeName: 'heavy_sync_action',
      expectedStatuses: [200, 302, 400],
      allowKnownHomologRedirect: true,
    });

    this.emitSlowTtfbIfExceeded(res, 'heavy_sync_action', vu, iter);

    this.metrics.recordChecks(res, {
      'Ação Pesada: completou sem 504 Gateway Timeout': () => res.status !== 504,
      'Ação Pesada: conexão não foi abortada prematuramente': () => res.status !== 0,
    });

    return res;
  }

  private emitSlowTtfbIfExceeded(
    res: TransportResponse,
    route: string,
    vu: number,
    iter: number
  ): void {
    if (res.durationMs >= 60_000) {
      this.logger.emit('WARN', 'k6.timeout.slow_ttfb', {
        env: this.env.name,
        route,
        status: res.status,
        duration_ms: Math.round(res.durationMs),
        vu,
        iter,
      });
    }
  }
}
