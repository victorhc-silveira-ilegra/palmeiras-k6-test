import { describe, expect, it } from 'vitest';
import {
  DomainInvariantError,
  ForbiddenProductionTargetError,
} from '../../../src/domain/errors/DomainError.ts';
import {
  TargetEnvironment,
  assertNotProd,
} from '../../../src/domain/value_objects/TargetEnvironment.ts';

describe('assertNotProd', () => {
  it('permite URLs e hosts exclusivos de HML', () => {
    expect(() =>
      assertNotProd('https://dev-sep-hml-160178191.us-east-1.elb.amazonaws.com', 'test')
    ).not.toThrow();
    expect(() => assertNotProd('hmlverdao.palmeiras.com.br', 'host')).not.toThrow();
    expect(() => assertNotProd('', 'empty')).not.toThrow();
    expect(() => assertNotProd(null)).not.toThrow();
  });

  it('aborta imediatamente ao detectar padroes de producao', () => {
    expect(() => assertNotProd('prod_alb', 'TARGET_ENV')).toThrow(ForbiddenProductionTargetError);
    expect(() => assertNotProd('https://www.palmeiras.com.br/noticias', 'url')).toThrow(
      ForbiddenProductionTargetError
    );
    expect(() => assertNotProd('https://Prod-Site-Azion-1627138501.elb.amazonaws.com', 'elb')).toThrow(
      ForbiddenProductionTargetError
    );
    expect(() => assertNotProd('1627138501', 'suffix')).toThrow(ForbiddenProductionTargetError);
  });
});

describe('TargetEnvironment', () => {
  it('resolve os tres alvos permitidos de HML', () => {
    const classic = TargetEnvironment.fromName('hml_classic_elb');
    expect(classic.name).toBe('hml_classic_elb');
    expect(classic.baseUrl).toBe('https://dev-sep-hml-160178191.us-east-1.elb.amazonaws.com');
    expect(classic.hostHeader).toBe('hmlverdao.palmeiras.com.br');
    expect(classic.insecureSkipTLSVerify).toBe(true);
    expect(classic.timeout).toBe('15s');

    const alb = TargetEnvironment.fromName('hml_alb');
    expect(alb.insecureSkipTLSVerify).toBe(false);
    expect(alb.timeout).toBe('10s');

    const edge = TargetEnvironment.fromName('azion_edge');
    expect(edge.baseUrl).toBe('https://hmlverdao.palmeiras.com.br');
  });

  it('rejeita alvos de producao ou desconhecidos com fail-fast', () => {
    expect(() => TargetEnvironment.fromName('prod_alb')).toThrow(ForbiddenProductionTargetError);
    expect(() => TargetEnvironment.fromName('staging_unknown')).toThrow(DomainInvariantError);
  });

  it('valida baseUrl e hostHeader customizados na construcao', () => {
    expect(() =>
      TargetEnvironment.create({
        name: 'hml_classic_elb',
        baseUrl: 'https://www.palmeiras.com.br',
        hostHeader: 'hmlverdao.palmeiras.com.br',
        insecureSkipTLSVerify: false,
        timeout: '10s',
      })
    ).toThrow(ForbiddenProductionTargetError);

    expect(() =>
      TargetEnvironment.create({
        name: 'hml_classic_elb',
        baseUrl: '   ',
        hostHeader: 'hmlverdao.palmeiras.com.br',
        insecureSkipTLSVerify: false,
        timeout: '10s',
      })
    ).toThrow(DomainInvariantError);

    expect(() =>
      TargetEnvironment.create({
        name: 'hml_classic_elb',
        baseUrl: 'https://dev-sep-hml-160178191.us-east-1.elb.amazonaws.com',
        hostHeader: '   ',
        insecureSkipTLSVerify: false,
        timeout: '10s',
      })
    ).toThrow(DomainInvariantError);
  });
});
