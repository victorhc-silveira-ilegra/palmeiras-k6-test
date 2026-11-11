import { TargetEnvironment } from '../../domain/value_objects/TargetEnvironment.ts';
import { ClockPort } from '../ports/ClockPort.ts';
import { TransportResponse } from '../ports/HttpTransportPort.ts';
import { MetricsRecorderPort } from '../ports/MetricsRecorderPort.ts';
import { HttpRouteClient } from './HttpRouteClient.ts';

export class RunWordpressRoutesUseCase {
  private readonly env: TargetEnvironment;
  private readonly client: HttpRouteClient;
  private readonly clock: ClockPort;
  private readonly metrics: MetricsRecorderPort;

  public constructor(
    env: TargetEnvironment,
    client: HttpRouteClient,
    clock: ClockPort,
    metrics: MetricsRecorderPort
  ) {
    this.env = env;
    this.client = client;
    this.clock = clock;
    this.metrics = metrics;
  }

  public checkHealth(): TransportResponse {
    const res = this.client.execute({
      path: '/check.html',
      tags: { type: 'static_health', route: 'healthcheck' },
      routeName: 'healthcheck',
    });
    this.metrics.recordChecks(res, {
      'healthcheck status 200': () => res.status === 200,
      'healthcheck body healthy': () => res.body.includes('healthy'),
    });
    return res;
  }

  public viewHomepage(): TransportResponse {
    const res = this.client.execute({
      path: '/',
      tags: { type: 'cache_hit', route: 'homepage' },
      routeName: 'homepage',
      allowKnownHomologRedirect: true,
      recordCache: true,
    });
    this.metrics.recordChecks(res, {
      'homepage status 200/302': () => [200, 302].includes(res.status),
    });
    return res;
  }

  public searchDynamic(term: string): TransportResponse {
    const res = this.client.execute({
      path: `/?s=${encodeURIComponent(term)}&nocache=${this.clock.nowMs()}`,
      tags: { type: 'dynamic_bypass', route: 'search' },
      routeName: 'search_html',
      allowKnownHomologRedirect: true,
      durationMetric: 'dynamic',
    });
    this.metrics.recordChecks(res, {
      'search status valid': () => [200, 302, 404].includes(res.status),
      'not 504 gateway timeout': () => res.status !== 504,
    });
    return res;
  }

  public searchWpRest(term: string, cacheBust = false, vu = 0, iter = 0): TransportResponse {
    const suffix = cacheBust ? `&nocache=${this.clock.nowMs()}_${vu}_${iter}` : '';
    const res = this.client.execute({
      path: `/wp-json/wp/v2/search?search=${encodeURIComponent(term)}${suffix}`,
      tags: { type: 'wp_search', route: 'wp_rest_search' },
      routeName: 'wp_rest_search',
      recordCache: true,
      durationMetric: 'wp_search',
    });
    const parsed = this.client.parseJson(res, 'wp_rest_search');
    this.metrics.recordChecks(res, {
      'wp search status 200': () => res.status === 200,
      'wp search valid json array': () => Array.isArray(parsed),
    });
    return res;
  }

  public fetchWpPosts(
    postId: number | null = null,
    cacheBust = false,
    vu = 0,
    iter = 0
  ): TransportResponse {
    const basePath = postId ? `/wp-json/wp/v2/posts/${postId}` : '/wp-json/wp/v2/posts?per_page=5';
    const sep = basePath.includes('?') ? '&' : '?';
    const suffix = cacheBust ? `${sep}nocache=${this.clock.nowMs()}_${vu}_${iter}` : '';
    const res = this.client.execute({
      path: `${basePath}${suffix}`,
      tags: { type: 'wp_rest', route: 'wp_rest_posts' },
      routeName: 'wp_rest_posts',
      recordCache: true,
      durationMetric: 'wp_rest',
    });
    this.metrics.recordChecks(res, {
      'wp posts status 200': () => res.status === 200,
    });
    return res;
  }

  public fetchWpPages(): TransportResponse {
    const res = this.client.execute({
      path: '/wp-json/wp/v2/pages?per_page=5',
      tags: { type: 'wp_rest', route: 'wp_rest_pages' },
      routeName: 'wp_rest_pages',
      recordCache: true,
      durationMetric: 'wp_rest',
    });
    this.metrics.recordChecks(res, {
      'wp pages status 200': () => res.status === 200,
    });
    return res;
  }

  public adminHeavyQuerySimulation(sessionCookie = ''): TransportResponse {
    const res = this.client.execute({
      path: '/wp-admin/admin-ajax.php?action=check_core_updates',
      tags: { type: 'admin_heavy', route: 'admin_ajax' },
      routeName: 'admin_ajax',
      extraHeaders: {
        Cookie: sessionCookie,
        'X-Requested-With': 'XMLHttpRequest',
        Host: this.env.hostHeader,
      },
      timeout: '25s',
      expectedStatuses: [200, 302, 400],
    });
    this.metrics.recordChecks(res, {
      'admin endpoint reachable (no 5xx)': () => ![500, 502, 503, 504].includes(res.status),
    });
    return res;
  }
}
