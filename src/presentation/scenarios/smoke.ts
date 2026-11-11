import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    smoke_execution: {
      executor: 'constant-vus',
      vus: 2,
      duration: '20s',
      gracefulStop: '5s',
    },
  },
  thresholds: getThresholdsForScenario('smoke'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'smoke',
    env: runtime.settings.environment.name,
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

export const handleSummary = createScenarioSummary('smoke', runtime.settings.environment.name);
