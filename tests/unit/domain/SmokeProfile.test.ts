import { describe, expect, it } from 'vitest';
import { resolveSmokeProfile, getSmokeConfiguration } from '../../../src/domain/services/SmokeProfile.ts';

describe('Perfis do smoke', () => {
  it('define o contrato funcional e preserva o perfil estrito', () => {
    expect(resolveSmokeProfile(undefined)).toBe('functional');
    expect(resolveSmokeProfile('')).toBe('functional');
    expect(resolveSmokeProfile('functional')).toBe('functional');
    expect(resolveSmokeProfile('strict')).toBe('strict');
    expect(() => resolveSmokeProfile('outro')).toThrow('SMOKE_PROFILE');
    const functional = getSmokeConfiguration('functional');
    expect(functional.timeout).toBe('15s');
    expect(functional.scenario).toMatchObject({ executor: 'per-vu-iterations', vus: 2, iterations: 1, maxDuration: '100s' });
    expect(functional.thresholds).toMatchObject({
      iterations: ['count==2'], http_req_failed: ['rate==0'], checks: ['rate==1'],
      'checks{check:no_prod_redirect}': ['rate==1'],
    });
    const strict = getSmokeConfiguration('strict');
    expect(strict.timeout).toBe('3s');
    expect(strict.scenario).toMatchObject({ executor: 'constant-vus', vus: 2, duration: '20s', gracefulStop: '5s' });
    expect(strict.thresholds.http_req_duration).toEqual(['p(95)<2000', 'p(99)<3500']);
    expect(strict.thresholds.iterations).toEqual(['count>=1']);
  });
});
