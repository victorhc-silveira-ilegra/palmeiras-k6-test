import { describe, expect, it } from 'vitest';
import datasetJson from '../../../data/hml-dataset.json';
import fanbaseJson from '../../../data/fanbase-model.json';
import { FanbaseModel, HmlDataset } from '../../../src/domain/entities/JourneyModels.ts';
import { K6DatasetAdapter } from '../../../src/infrastructure/k6/K6DatasetAdapter.ts';
import {
  K6HttpClientLike,
  K6HttpTransportAdapter,
} from '../../../src/infrastructure/k6/K6HttpTransportAdapter.ts';
import { K6MetricsAdapter, K6MetricBindings } from '../../../src/infrastructure/k6/K6MetricsAdapter.ts';
import { createSummaryHandler } from '../../../src/infrastructure/k6/K6ReporterAdapter.ts';
import { SystemClockAdapter } from '../../../src/infrastructure/repositories/SystemClockAdapter.ts';

describe('K6 Infrastructure Adapters Integration', () => {
  it('K6HttpTransportAdapter executa todos os metodos HTTP forcando redirects 0 e expectedStatuses', () => {
    const calls: Array<{
      method: string;
      url: string;
      redirects: number | undefined;
      expected?: unknown;
    }> = [];
    const mockK6Http: K6HttpClientLike = {
      get: (url, params) => {
        calls.push({ method: 'GET', url, redirects: params?.redirects, expected: params?.responseCallback });
        return { status: 200, body: 'ok', headers: { 'X-Test': '1' }, timings: { duration: 15 } };
      },
      head: (url, params) => {
        calls.push({ method: 'HEAD', url, redirects: params?.redirects });
        return { status: 200, body: null, headers: {}, timings: { duration: 5 } };
      },
      options: (url, _body, params) => {
        calls.push({ method: 'OPTIONS', url, redirects: params?.redirects });
        return { status: 200, body: new ArrayBuffer(0), headers: {}, timings: { duration: 6 } };
      },
      post: (url, _body, params) => {
        calls.push({ method: 'POST', url, redirects: params?.redirects, expected: params?.responseCallback });
        return { status: 400, body: '0', headers: {}, timings: { duration: 9 } };
      },
      expectedStatuses: (...statuses) => ({ statuses }),
    };

    const adapter = new K6HttpTransportAdapter(mockK6Http);
    expect(
      adapter.request({
        method: 'GET',
        url: 'https://hml.example/posts',
        headers: {},
        timeout: '10s',
        tags: { route: 'posts' },
        expectedStatuses: [200, 500],
      }).body
    ).toBe('ok');
    expect(
      adapter.request({
        method: 'HEAD',
        url: 'https://hml.example/check.html',
        headers: {},
        timeout: '10s',
        tags: { route: 'health' },
      }).body
    ).toBe('');
    expect(
      adapter.request({
        method: 'OPTIONS',
        url: 'https://hml.example/posts',
        headers: {},
        timeout: '10s',
        tags: { route: 'opt' },
      }).body
    ).toBe('');
    expect(
      adapter.request({
        method: 'POST',
        url: 'https://hml.example/ajax',
        body: 'action=ping',
        headers: {},
        timeout: '10s',
        tags: { route: 'post' },
      }).status
    ).toBe(400);
    expect(
      adapter.request({
        method: 'POST',
        url: 'https://hml.example/ajax-empty',
        headers: {},
        timeout: '10s',
        tags: { route: 'post_empty' },
      }).status
    ).toBe(400);

    expect(calls.every((c) => c.redirects === 0)).toBe(true);
    expect(calls[0]?.expected).toEqual({ statuses: [200, 500] });
  });

  it('K6MetricsAdapter delega para todos os contadores, trends, rates e checks do k6', () => {
    const added: Record<string, number[]> = {};
    const makeMetric = (name: string): { add: (v: number) => void } => ({
      add: (v: number): void => {
        added[name] = [...(added[name] ?? []), v];
      },
    });

    const bindings: K6MetricBindings = {
      cacheHitRate: makeMetric('cache_hit_rate'),
      dynamicQueryDuration: makeMetric('dynamic_query_duration'),
      wpRestDuration: makeMetric('wp_rest_duration'),
      wpSearchDuration: makeMetric('wp_search_duration'),
      journeyProcessingDuration: makeMetric('journey_processing_duration'),
      deadlocksCounter: makeMetric('db_deadlocks_detected'),
      rateLimitHitCounter: makeMetric('rate_limit_429_hits'),
      prodRedirectBlockedCounter: makeMetric('prod_redirect_detected'),
      phpFatalDetectedCounter: makeMetric('php_fatal_or_db_error_detected'),
      phpWarningLeakCounter: makeMetric('php_warning_leak_detected'),
      jsonRecordsProcessedCounter: makeMetric('json_records_processed'),
      known500RegressionCounter: makeMetric('known_hml_500_endpoints'),
      checkFn: (val, checks) => Object.values(checks).every((fn) => fn(val)),
    };

    const adapter = new K6MetricsAdapter(bindings);
    adapter.recordCacheHit(true);
    adapter.recordCacheHit(false);
    adapter.recordDynamicQueryDuration(10);
    adapter.recordWpRestDuration(20);
    adapter.recordWpSearchDuration(30);
    adapter.recordJourneyProcessingDuration(40);
    adapter.incrementDeadlock();
    adapter.incrementRateLimit();
    adapter.incrementProdRedirect();
    adapter.incrementPhpFatal();
    adapter.incrementPhpWarningLeak();
    adapter.incrementJsonRecordsProcessed(5);
    adapter.incrementKnown500Regression();
    const checked = adapter.recordChecks(
      { status: 200, body: 'ok', headers: {}, durationMs: 10 },
      { status_ok: () => true }
    );

    expect(checked).toBe(true);
    expect(added.cache_hit_rate).toEqual([1, 0]);
    expect(added.json_records_processed).toEqual([5]);
    expect(added.known_hml_500_endpoints).toEqual([1]);
  });

  it('K6DatasetAdapter carrega e valida os JSONs reais de HML do repositorio', () => {
    const datasetRaw = datasetJson as HmlDataset;
    const fanbaseRaw = fanbaseJson as FanbaseModel;

    const adapter = new K6DatasetAdapter(
      () => datasetRaw,
      () => fanbaseRaw
    );
    expect(adapter.getHmlDataset().posts.length).toBeGreaterThan(0);
    expect(adapter.getHmlDataset().search_terms).toContain('palmeiras');
    expect(adapter.getFanbaseModel().fanbase.min_supporters).toBe(14_000_000);
  });

  it('K6ReporterAdapter e SystemClockAdapter geram resumo e relogio corretos', () => {
    const clock = new SystemClockAdapter();
    expect(clock.nowMs()).toBeGreaterThan(1_700_000_000_000);
    const rnd = clock.random();
    expect(rnd).toBeGreaterThanOrEqual(0);
    expect(rnd).toBeLessThan(1);

    const handler = createSummaryHandler(
      'fanbase_simul',
      'hml_classic_elb',
      {
        htmlReport: (d) => `<html>${JSON.stringify(d)}</html>`,
        textSummary: () => 'SUMMARY TEXT',
      },
      () => new Date('2026-11-11T22:00:00.000Z')
    );

    const out = handler({ metrics: {} });
    const htmlKey = 'reports/summary-hml_classic_elb-fanbase_simul-2026-11-11T22-00-00-000Z.html';
    const jsonKey = 'reports/summary-hml_classic_elb-fanbase_simul-2026-11-11T22-00-00-000Z.json';
    expect(out[htmlKey]).toContain('<html>');
    expect(out[jsonKey]).toBe('{"metrics":{}}');
    expect(out.stdout).toBe('SUMMARY TEXT');

    const defaultNowHandler = createSummaryHandler('smoke', 'hml_classic_elb', {
      htmlReport: () => '<html />',
      textSummary: () => 'TXT',
    });
    const defaultOut = defaultNowHandler({ metrics: {} });
    expect(defaultOut.stdout).toBe('TXT');
  });
});
