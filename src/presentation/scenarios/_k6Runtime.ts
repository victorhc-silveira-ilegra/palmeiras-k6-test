import { check } from 'k6';
import { SharedArray } from 'k6/data';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { FanbaseModel, HmlDataset } from '../../domain/entities/JourneyModels.ts';
import { createSummaryHandler } from '../../infrastructure/k6/K6ReporterAdapter.ts';
import {
  RuntimeContainer,
  createRuntimeContainer,
} from '../composition/createRuntimeContainer.ts';

const hmlDatasetShared = new SharedArray<HmlDataset>('hml_dataset', () => [
  JSON.parse(open('../../../data/hml-dataset.json')) as HmlDataset,
]);

const fanbaseModelShared = new SharedArray<FanbaseModel>('fanbase_model', () => [
  JSON.parse(open('../../../data/fanbase-model.json')) as FanbaseModel,
]);

const k6MetricBindings = {
  cacheHitRate: new Rate('cache_hit_rate'),
  dynamicQueryDuration: new Trend('dynamic_query_duration', true),
  wpRestDuration: new Trend('wp_rest_duration', true),
  wpSearchDuration: new Trend('wp_search_duration', true),
  journeyProcessingDuration: new Trend('journey_processing_duration', true),
  deadlocksCounter: new Counter('db_deadlocks_detected'),
  rateLimitHitCounter: new Counter('rate_limit_429_hits'),
  prodRedirectBlockedCounter: new Counter('prod_redirect_detected'),
  phpFatalDetectedCounter: new Counter('php_fatal_or_db_error_detected'),
  phpWarningLeakCounter: new Counter('php_warning_leak_detected'),
  jsonRecordsProcessedCounter: new Counter('json_records_processed'),
  known500RegressionCounter: new Counter('known_hml_500_endpoints'),
  gatewayTimeout504Counter: new Counter('gateway_timeout_504'),
  edgeTransportDropCounter: new Counter('edge_transport_drop'),
  post504SessionBlockedCounter: new Counter('post_504_session_blocked'),
  upstreamTtfbDuration: new Trend('upstream_ttfb_ms', true),
  checkFn: check,
};

export function createScenarioRuntime(): RuntimeContainer {
  return createRuntimeContainer({
    envSource: __ENV,
    k6Http: http,
    k6Metrics: k6MetricBindings,
    loadDataset: (): HmlDataset => {
      const item = hmlDatasetShared[0];
      if (!item) {
        throw new Error('Dataset HML indisponivel.');
      }
      return item;
    },
    loadFanbaseModel: (): FanbaseModel => {
      const item = fanbaseModelShared[0];
      if (!item) {
        throw new Error('Modelo fanbase HML indisponivel.');
      }
      return item;
    },
  });
}

export function createScenarioSummary(
  scenarioName: string,
  envName: string
): (data: unknown) => Record<string, string> {
  return createSummaryHandler(scenarioName, envName, {
    htmlReport,
    textSummary,
  });
}
