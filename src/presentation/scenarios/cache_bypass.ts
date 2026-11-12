import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    origin_cache_bypass: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      gracefulStop: '10s',
    },
  },
  thresholds: getThresholdsForScenario('cache_bypass'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'cache_bypass',
    env: runtime.settings.environment.name,
    base_url: runtime.settings.environment.baseUrl,
  });
}

export default function (): void {
  const data = runtime.dataset.getHmlDataset();
  const term = data.search_terms[__ITER % data.search_terms.length] ?? 'palmeiras';
  const post = data.posts[__ITER % data.posts.length];

  runtime.wpRoutes.fetchWpPosts(post?.id ?? null, true, __VU, __ITER);
  runtime.wpRoutes.searchWpRest(term, true, __VU, __ITER);
  runtime.palmeirasApi.searchNoticiasApi(term, true, __VU, __ITER);
  runtime.timeoutDiagnostic.probeAuthenticatedAdminAndAjax(
    {
      authCookie: runtime.settings.wpAuthCookie,
      wpNonce: runtime.settings.wpNonce,
      ajaxAction: runtime.settings.wpAjaxAction,
      adminPath: runtime.settings.wpAdminPath,
    },
    __VU,
    __ITER
  );
  sleep(1);
}

export const handleSummary = createScenarioSummary(
  'cache_bypass',
  runtime.settings.environment.name
);
