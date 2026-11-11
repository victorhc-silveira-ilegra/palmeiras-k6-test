import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    stress_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 10 },
        { duration: '1m30s', target: 25 },
        { duration: '1m30s', target: 40 },
        { duration: '45s', target: 0 },
      ],
      gracefulRampDown: '20s',
    },
  },
  thresholds: getThresholdsForScenario('stress'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'stress',
    env: runtime.settings.environment.name,
  });
}

export default function (): void {
  const data = runtime.dataset.getHmlDataset();
  const term = data.search_terms[Math.floor(Math.random() * data.search_terms.length)] ?? 'palmeiras';
  const post = data.posts[Math.floor(Math.random() * data.posts.length)];
  const rand = Math.random();

  if (rand < 0.2) {
    runtime.wpRoutes.checkHealth();
  } else if (rand < 0.5 && post) {
    runtime.wpRoutes.fetchWpPosts(post.id);
  } else if (rand < 0.75) {
    runtime.wpRoutes.searchWpRest(term);
  } else if (rand < 0.9) {
    runtime.palmeirasApi.searchNoticiasApi(term);
  } else if (rand < 0.96) {
    runtime.palmeirasApi.fetchEstatisticas();
  } else {
    runtime.wpRoutes.adminHeavyQuerySimulation();
  }
  sleep(0.5);
}

export const handleSummary = createScenarioSummary('stress', runtime.settings.environment.name);
