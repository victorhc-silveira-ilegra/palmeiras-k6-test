import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    estabilidade_continua_sessao: {
      executor: 'constant-vus',
      vus: Math.min(runtime.settings.soakVus, 2),
      duration: runtime.settings.soakDuration,
      gracefulStop: '10s',
    },
  },
  thresholds: getThresholdsForScenario('soak'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'soak',
    env: runtime.settings.environment.name,
    base_url: runtime.settings.environment.baseUrl,
  });
}

export default function (): void {
  const data = runtime.dataset.getHmlDataset();
  const post = data.posts[__ITER % data.posts.length];

  runtime.wpRoutes.checkHealth();
  runtime.wpRoutes.fetchWpPosts(post?.id ?? null, true, __VU, __ITER);
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
  sleep(2);
}

export const handleSummary = createScenarioSummary('soak', runtime.settings.environment.name);
