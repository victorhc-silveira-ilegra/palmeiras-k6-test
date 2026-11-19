import { sleep } from 'k6';
import { getSmokeConfiguration, resolveSmokeProfile } from '../../domain/services/SmokeProfile.ts';
import { createScenarioRuntime, createScenarioSummary, createScenarioNetworkOptions } from './_k6Runtime.ts';

const profile = resolveSmokeProfile(__ENV.SMOKE_PROFILE);
const config = getSmokeConfiguration(profile);
const runtime = createScenarioRuntime({
  ...__ENV,
  REQUEST_TIMEOUT: __ENV.REQUEST_TIMEOUT?.trim() || config.timeout,
});
const startedAtUtc = new Date().toISOString();
const multiProxyIp = __ENV.SMOKE_MULTI_PROXY_IP;
const directMultiProxy =
  runtime.settings.environment.baseUrl === 'https://hmlverdao.palmeiras.com.br' &&
  runtime.settings.environment.name === 'azion_edge' &&
  Boolean(multiProxyIp);
const route = __ENV.HML_ROUTE || (directMultiProxy ? 'hml_multi_proxy' : runtime.settings.environment.name);

export const options = {
  ...createScenarioNetworkOptions(runtime.settings.environment),
  scenarios: {
    validacao_rapida_saude: config.scenario,
  },
  thresholds: config.thresholds,
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'smoke',
    env: route,
    profile,
    request_timeout: runtime.settings.environment.timeout,
    started_at_utc: startedAtUtc,
  });
}

export default function (): void {
  const data = runtime.dataset.getHmlDataset();
  const post = data.posts[__ITER % data.posts.length];
  const term = data.search_terms[__ITER % data.search_terms.length];

  runtime.wpRoutes.checkHealth();
  runtime.wpRoutes.viewHomepage();
  if (post) {
    runtime.wpRoutes.fetchWpPosts(post.id);
  }
  runtime.palmeirasApi.fetchClassificacao();
  if (term) {
    runtime.wpRoutes.searchWpRest(term);
  }
  runtime.palmeirasApi.checkToAppAuthGuard();
  sleep(1);
}

export const handleSummary = createScenarioSummary('smoke', route, {
  profile,
  path: route,
  timeout: runtime.settings.environment.timeout,
  startedAtUtc,
});
