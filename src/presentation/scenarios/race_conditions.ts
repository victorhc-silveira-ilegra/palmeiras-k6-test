import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    lock_contention: {
      executor: 'per-vu-iterations',
      vus: 20,
      iterations: 1,
      maxDuration: '15s',
    },
  },
  thresholds: getThresholdsForScenario('race_condition'),
};

export function setup(): void {
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'race_conditions',
    env: runtime.settings.environment.name,
  });
}

export default function (): void {
  const singleSeatId = 'CADEIRA_GOL_NORTE_104';
  const userId = `torcedor_${__VU}`;
  runtime.claimTicket.execute(userId, 'FINAL_COPA_2026', singleSeatId);
}

export const handleSummary = createScenarioSummary(
  'race_conditions',
  runtime.settings.environment.name
);
