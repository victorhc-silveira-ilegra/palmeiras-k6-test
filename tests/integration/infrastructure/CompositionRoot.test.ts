import { describe, expect, it } from 'vitest';
import { ForbiddenProductionTargetError } from '../../../src/domain/errors/DomainError.ts';
import { K6HttpClientLike } from '../../../src/infrastructure/k6/K6HttpTransportAdapter.ts';
import { K6MetricBindings } from '../../../src/infrastructure/k6/K6MetricsAdapter.ts';
import { createRuntimeContainer } from '../../../src/presentation/composition/createRuntimeContainer.ts';

describe('createRuntimeContainer', () => {
  const mockHttp: K6HttpClientLike = {
    get: () => ({ status: 200, body: 'healthy', headers: {}, timings: { duration: 10 } }),
    head: () => ({ status: 200, body: '', headers: {}, timings: { duration: 5 } }),
    options: () => ({ status: 200, body: '', headers: {}, timings: { duration: 5 } }),
    post: () => ({ status: 400, body: '0', headers: {}, timings: { duration: 8 } }),
    expectedStatuses: (...s) => s,
  };

  const noopMetric = { add: (): void => undefined };
  const mockMetrics: K6MetricBindings = {
    cacheHitRate: noopMetric,
    dynamicQueryDuration: noopMetric,
    wpRestDuration: noopMetric,
    wpSearchDuration: noopMetric,
    journeyProcessingDuration: noopMetric,
    deadlocksCounter: noopMetric,
    rateLimitHitCounter: noopMetric,
    prodRedirectBlockedCounter: noopMetric,
    phpFatalDetectedCounter: noopMetric,
    phpWarningLeakCounter: noopMetric,
    jsonRecordsProcessedCounter: noopMetric,
    known500RegressionCounter: noopMetric,
    checkFn: (v, checks) => Object.values(checks).every((fn) => fn(v)),
  };

  it('compoe container completo em HML e executa casos de uso sem erros', () => {
    const container = createRuntimeContainer({
      envSource: { TARGET_ENV: 'hml_classic_elb', SCALE_FACTOR: '0.5' },
      k6Http: mockHttp,
      k6Metrics: mockMetrics,
      loadDataset: () => ({
        generated_at_env: 'hml',
        host_header: 'hmlverdao.palmeiras.com.br',
        posts: [{ id: 174533, slug: 'teste', path: '/noticias/teste/' }],
        pages: [{ id: 18425, slug: 'noticias', path: '/noticias/' }],
        categories: [{ id: 3060, slug: 'basquete', count: 10 }],
        search_terms: ['palmeiras'],
        rest_endpoints_public: ['/wp-json/wp/v2/posts?per_page=5'],
      }),
      loadFanbaseModel: () => ({
        club: 'SEP',
        environment: 'HML',
        fanbase: {
          min_supporters: 14_000_000,
          max_supporters: 17_500_000,
          avg_supporters: 15_750_000,
          brazil_preference_pct_min: 6.5,
          brazil_preference_pct_max: 8.1,
        },
        traffic_persona_weights: {
          news_readers_pct: 35,
          matchday_live_table_pct: 25,
          dynamic_searchers_pct: 15,
          catalog_media_stores_pct: 10,
          mobile_app_toapp_pct: 8,
          protocol_edge_matrix_pct: 7,
        },
        hml_infra_limits: {
          ec2_instance_type: 't3a.medium',
          vcpus: 2,
          ram_mb: 3863,
          php_fpm_max_children: 35,
          port_84_fastcgi_cache: false,
        },
      }),
    });

    expect(container.settings.environment.name).toBe('hml_classic_elb');
    expect(container.fanbaseAllocation.totalPeakVUs).toBe(19);
    expect(container.wpRoutes.checkHealth().status).toBe(200);
    expect(container.dataset.getHmlDataset().posts[0]?.id).toBe(174533);
  });

  it('falha no composition root se TARGET_ENV for producao', () => {
    expect(() =>
      createRuntimeContainer({
        envSource: { TARGET_ENV: 'prod_alb' },
        k6Http: mockHttp,
        k6Metrics: mockMetrics,
        loadDataset: () => ({
          generated_at_env: 'hml',
          host_header: 'hmlverdao.palmeiras.com.br',
          posts: [],
          pages: [],
          categories: [],
          search_terms: [],
          rest_endpoints_public: [],
        }),
        loadFanbaseModel: () => ({
          club: 'SEP',
          environment: 'HML',
          fanbase: {
            min_supporters: 14_000_000,
            max_supporters: 17_500_000,
            avg_supporters: 15_750_000,
            brazil_preference_pct_min: 6.5,
            brazil_preference_pct_max: 8.1,
          },
          traffic_persona_weights: {
            news_readers_pct: 35,
            matchday_live_table_pct: 25,
            dynamic_searchers_pct: 15,
            catalog_media_stores_pct: 10,
            mobile_app_toapp_pct: 8,
            protocol_edge_matrix_pct: 7,
          },
          hml_infra_limits: {
            ec2_instance_type: 't3a.medium',
            vcpus: 2,
            ram_mb: 3863,
            php_fpm_max_children: 35,
            port_84_fastcgi_cache: false,
          },
        }),
      })
    ).toThrow(ForbiddenProductionTargetError);
  });
});
