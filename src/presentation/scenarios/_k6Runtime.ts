import { TargetEnvironment } from '../../domain/value_objects/TargetEnvironment.ts';
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

const topologyConfig = JSON.parse(open('../../../data/hml-topology.json')) as { hostname: string };

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

export function createScenarioNetworkOptions(environment: TargetEnvironment): Record<string, unknown> {
  const ip = __ENV.HML_ALB_IP || __ENV.SMOKE_MULTI_PROXY_IP;
  const mapped = Boolean(ip) && environment.baseUrl === 'https://hmlverdao.palmeiras.com.br';
  if (environment.name === 'hml_alb' && environment.baseUrl.startsWith('https://') && !ip) {
    throw new Error('Use o executor HML para resolver o ALB antes da execução.');
  }
  return {
    insecureSkipTLSVerify: environment.insecureSkipTLSVerify,
    hosts: mapped ? { [environment.hostHeader]: ip } : {},
    tags: { run_id: __ENV.HML_RUN_ID || 'untracked', path: __ENV.HML_ROUTE || environment.name },
  };
}

export function createScenarioRuntime(envSource = __ENV): RuntimeContainer {
  const target = envSource.TARGET_ENV || 'azion_edge';
  if (target === 'hml_classic_elb' && envSource.HML_TOPOLOGY !== 'legacy') {
    throw new Error('O Classic ELB exige HML_TOPOLOGY=legacy.');
  }
  if (['hml_ec2_direct', 'ec2_direct'].includes(target) && !envSource.TARGET_URL) {
    throw new Error('Use o executor HML para abrir o túnel de uma EC2 saudável.');
  }
  const targetUrl = envSource.TARGET_URL ||
    (['azion_edge', 'hml_alb'].includes(target) ? `https://${topologyConfig.hostname}` : '');
  return createRuntimeContainer({
    envSource: { ...envSource, TARGET_URL: targetUrl },
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
  envName: string,
  metadata?: Record<string, string>
): (data: unknown) => Record<string, string> {
  return createSummaryHandler(scenarioName, envName, {
    htmlReport,
    textSummary,
  }, undefined, {
    run_id: __ENV.HML_RUN_ID || 'untracked',
    path: __ENV.HML_ROUTE || envName,
    topology: __ENV.HML_TOPOLOGY || 'current',
    ...metadata,
  });
}
