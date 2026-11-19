import { DomainInvariantError } from '../errors/DomainError.ts';
import { ThresholdMap } from '../entities/JourneyModels.ts';
import { getThresholdsForScenario } from './ThresholdCatalog.ts';

export type SmokeProfile = 'functional' | 'strict';

export function resolveSmokeProfile(raw: string | undefined): SmokeProfile {
  const profile = raw || 'functional';
  if (profile !== 'functional' && profile !== 'strict') {
    throw new DomainInvariantError('SMOKE_PROFILE deve ser functional ou strict.');
  }
  return profile;
}

export function getSmokeConfiguration(profile: SmokeProfile): {
  timeout: string;
  scenario: Record<string, string | number>;
  thresholds: ThresholdMap;
} {
  if (profile === 'strict') {
    return {
      timeout: '3s',
      scenario: { executor: 'constant-vus', vus: 2, duration: '20s', gracefulStop: '5s' },
      thresholds: { ...getThresholdsForScenario('smoke'), checks: ['rate==1'] },
    };
  }
  return {
    timeout: '15s',
    scenario: {
      executor: 'per-vu-iterations',
      vus: 2,
      iterations: 1,
      maxDuration: '100s',
      gracefulStop: '0s',
    },
    thresholds: {
      iterations: ['count==2'],
      http_req_failed: ['rate==0'],
      checks: ['rate==1'],
      'checks{check:no_prod_redirect}': ['rate==1'],
    },
  };
}
