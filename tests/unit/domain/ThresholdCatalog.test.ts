import { describe, expect, it } from 'vitest';
import { getThresholdsForScenario } from '../../../src/domain/services/ThresholdCatalog.ts';

describe('ThresholdCatalog', () => {
  it('retorna thresholds definidos para todos os nove cenarios mantendo invariante no_prod_redirect', () => {
    const scenarios = [
      'smoke',
      'load',
      'api_mix',
      'fanbase_simul',
      'stress',
      'spike',
      'soak',
      'cache_bypass',
      'race_condition',
    ] as const;

    for (const scenario of scenarios) {
      const profile = getThresholdsForScenario(scenario);
      expect(profile['checks{check:no_prod_redirect}']).toEqual(['rate==1']);
      expect(profile.http_req_failed).toBeDefined();
    }
  });
});
