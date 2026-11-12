import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    palmeiras_api_mix: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 10,
      maxDuration: '360s',
    },
  },
  thresholds: getThresholdsForScenario('api_mix'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'api_mix',
    env: runtime.settings.environment.name,
    base_url: runtime.settings.environment.baseUrl,
  });
}

export default function (): void {
  const data = runtime.dataset.getHmlDataset();
  const term = data.search_terms[__ITER % data.search_terms.length] ?? 'palmeiras';
  const post = data.posts[__ITER % data.posts.length];
  const step = __ITER % 10;

  switch (step) {
    case 0:
      runtime.wpRoutes.fetchWpPosts(post?.id ?? null, true, __VU, __ITER);
      break;
    case 1:
      runtime.palmeirasApi.fetchClassificacao();
      break;
    case 2:
      runtime.palmeirasApi.fetchJogosMes();
      break;
    case 3:
      runtime.palmeirasApi.fetchEventosMes();
      break;
    case 4:
      runtime.palmeirasApi.searchNoticiasApi(term, true, __VU, __ITER);
      break;
    case 5:
      runtime.palmeirasApi.fetchEstatisticas();
      break;
    case 6:
      runtime.palmeirasApi.fetchSepLojas();
      break;
    case 7:
      runtime.palmeirasApi.fetchFotos();
      break;
    case 8:
      runtime.wpRoutes.searchWpRest(term, true, __VU, __ITER);
      break;
    default:
      runtime.wpRoutes.fetchWpPages();
      runtime.palmeirasApi.checkToAppAuthGuard();
      break;
  }
  sleep(0.5);
}

export const handleSummary = createScenarioSummary('api_mix', runtime.settings.environment.name);
