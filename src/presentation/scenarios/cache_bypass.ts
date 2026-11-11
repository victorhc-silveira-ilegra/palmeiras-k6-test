import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    origin_cache_bypass: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 6 },
        { duration: '1m', target: 15 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: getThresholdsForScenario('cache_bypass'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'cache_bypass',
    env: runtime.settings.environment.name,
  });
}

export default function (): void {
  const data = runtime.dataset.getHmlDataset();
  const term = data.search_terms[Math.floor(Math.random() * data.search_terms.length)] ?? 'palmeiras';
  const post = data.posts[Math.floor(Math.random() * data.posts.length)];

  runtime.wpRoutes.fetchWpPosts(post?.id ?? null, true, __VU, __ITER);
  runtime.wpRoutes.searchWpRest(term, true, __VU, __ITER);
  runtime.palmeirasApi.searchNoticiasApi(term, true, __VU, __ITER);
  sleep(0.5);
}

export const handleSummary = createScenarioSummary(
  'cache_bypass',
  runtime.settings.environment.name
);
