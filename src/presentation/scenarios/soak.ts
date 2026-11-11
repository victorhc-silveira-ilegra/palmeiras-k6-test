import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    hml_soak: {
      executor: 'constant-vus',
      vus: runtime.settings.soakVus,
      duration: runtime.settings.soakDuration,
      gracefulStop: '15s',
    },
  },
  thresholds: getThresholdsForScenario('soak'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'soak',
    env: runtime.settings.environment.name,
  });
}

export default function (): void {
  const data = runtime.dataset.getHmlDataset();
  const post = data.posts[__ITER % data.posts.length];
  const term = data.search_terms[__ITER % data.search_terms.length] ?? 'palmeiras';

  runtime.wpRoutes.checkHealth();
  if (post) {
    runtime.wpRoutes.fetchWpPosts(post.id);
  }
  runtime.palmeirasApi.fetchClassificacao();
  if (__ITER % 3 === 0) {
    runtime.palmeirasApi.fetchJogosMes();
    runtime.wpRoutes.searchWpRest(term);
  }
  sleep(1.5);
}

export const handleSummary = createScenarioSummary('soak', runtime.settings.environment.name);
