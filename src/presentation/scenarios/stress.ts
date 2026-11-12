import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    edge_handshake_probe: {
      executor: 'constant-vus',
      vus: 2,
      duration: '20s',
      gracefulStop: '10s',
    },
  },
  thresholds: getThresholdsForScenario('stress'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'stress',
    env: runtime.settings.environment.name,
    base_url: runtime.settings.environment.baseUrl,
  });
}

export default function (): void {
  const data = runtime.dataset.getHmlDataset();
  const term = data.search_terms[__ITER % data.search_terms.length] ?? 'palmeiras';

  runtime.wpRoutes.checkHealth();
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
  sleep(0.5);
}

export const handleSummary = createScenarioSummary('stress', runtime.settings.environment.name);
