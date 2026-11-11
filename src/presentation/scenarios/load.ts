import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    rest_browsing: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 8 },
        { duration: '1m', target: 15 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
      exec: 'browseFlow',
    },
    dynamic_searchers: {
      executor: 'constant-arrival-rate',
      rate: 4,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 8,
      maxVUs: 20,
      exec: 'searchFlow',
    },
  },
  thresholds: getThresholdsForScenario('load'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'load',
    env: runtime.settings.environment.name,
  });
}

export function browseFlow(): void {
  const data = runtime.dataset.getHmlDataset();
  const post = data.posts[Math.floor(Math.random() * data.posts.length)];
  const r = Math.random();

  if (r < 0.25) {
    runtime.wpRoutes.checkHealth();
  } else if (r < 0.5 && post) {
    runtime.wpRoutes.fetchWpPosts(post.id);
  } else if (r < 0.7) {
    runtime.palmeirasApi.fetchClassificacao();
  } else if (r < 0.85) {
    runtime.palmeirasApi.fetchJogosMes();
  } else {
    runtime.wpRoutes.fetchWpPages();
  }
  sleep(1);
}

export function searchFlow(): void {
  const terms = runtime.dataset.getHmlDataset().search_terms;
  const term = terms[Math.floor(Math.random() * terms.length)] ?? 'palmeiras';
  if (Math.random() < 0.5) {
    runtime.wpRoutes.searchWpRest(term);
  } else {
    runtime.palmeirasApi.searchNoticiasApi(term);
  }
}

export const handleSummary = createScenarioSummary('load', runtime.settings.environment.name);
