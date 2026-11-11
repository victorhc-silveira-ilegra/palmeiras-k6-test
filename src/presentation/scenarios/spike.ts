import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    matchday_surge: {
      executor: 'ramping-vus',
      startVUs: 2,
      stages: [
        { duration: '20s', target: 5 },
        { duration: '10s', target: 35 },
        { duration: '1m', target: 35 },
        { duration: '15s', target: 5 },
        { duration: '20s', target: 5 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: getThresholdsForScenario('spike'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'spike',
    env: runtime.settings.environment.name,
  });
}

export default function (): void {
  const data = runtime.dataset.getHmlDataset();
  const post = data.posts[__VU % data.posts.length];

  if (__VU % 5 === 0) {
    runtime.wpRoutes.checkHealth();
  } else if (__VU % 3 === 0) {
    runtime.palmeirasApi.fetchJogosMes();
  } else {
    runtime.palmeirasApi.fetchClassificacao();
    if (post) {
      runtime.wpRoutes.fetchWpPosts(post.id);
    }
  }

  if (__VU % 4 === 0) {
    runtime.wpRoutes.searchWpRest('libertadores');
  }
  sleep(0.3);
}

export const handleSummary = createScenarioSummary('spike', runtime.settings.environment.name);
