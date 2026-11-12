import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    rajada_curta_reconexao_2vus: {
      executor: 'per-vu-iterations',
      vus: 2,
      iterations: 2,
      maxDuration: '360s',
    },
  },
  thresholds: getThresholdsForScenario('spike'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'spike',
    env: runtime.settings.environment.name,
    base_url: runtime.settings.environment.baseUrl,
  });
}

export default function (): void {
  const data = runtime.dataset.getHmlDataset();
  const term = data.search_terms[__ITER % data.search_terms.length] ?? 'palmeiras';

  runtime.wpRoutes.searchWpRest(term, true, __VU, __ITER);
  runtime.timeoutDiagnostic.probeSessionLockContention(
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

export const handleSummary = createScenarioSummary('spike', runtime.settings.environment.name);
