import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    teste_acao_pesada_sync: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '360s',
    },
  },
  thresholds: getThresholdsForScenario('heavy_sync_probe'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'heavy_sync_probe',
    env: runtime.settings.environment.name,
    base_url: runtime.settings.environment.baseUrl,
  });
}

export default function (): void {
  const targetPath =
    __ENV.HEAVY_PATH && __ENV.HEAVY_PATH.trim()
      ? __ENV.HEAVY_PATH.trim()
      : runtime.settings.wpAdminPath;

  runtime.timeoutDiagnostic.probeHeavySynchronousAction(
    targetPath,
    {
      authCookie: runtime.settings.wpAuthCookie,
      wpNonce: runtime.settings.wpNonce,
      ajaxAction: runtime.settings.wpAjaxAction,
      adminPath: runtime.settings.wpAdminPath,
    },
    __VU,
    __ITER
  );
}

export const handleSummary = createScenarioSummary(
  'heavy_sync_probe',
  runtime.settings.environment.name
);
