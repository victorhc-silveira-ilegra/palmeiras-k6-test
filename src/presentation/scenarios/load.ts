import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    timeout_boundary_probe: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 3,
      maxDuration: '360s',
    },
  },
  thresholds: getThresholdsForScenario('load'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'load',
    env: runtime.settings.environment.name,
    base_url: runtime.settings.environment.baseUrl,
  });
}

export default function (): void {
  const data = runtime.dataset.getHmlDataset();
  const term = data.search_terms[__ITER % data.search_terms.length] ?? 'palmeiras';

  runtime.wpRoutes.checkHealth();
  runtime.wpRoutes.searchDynamic(term);
  runtime.wpRoutes.searchWpRest(term, true, __VU, __ITER);
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

export const handleSummary = createScenarioSummary('load', runtime.settings.environment.name);
