import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    session_lock_contention: {
      executor: 'per-vu-iterations',
      vus: 2,
      iterations: 1,
      maxDuration: '360s',
    },
  },
  thresholds: getThresholdsForScenario('race_condition'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'race_conditions',
    env: runtime.settings.environment.name,
    base_url: runtime.settings.environment.baseUrl,
  });
}

export default function (): void {
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
}

export const handleSummary = createScenarioSummary(
  'race_conditions',
  runtime.settings.environment.name
);
