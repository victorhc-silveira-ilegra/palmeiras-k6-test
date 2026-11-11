import { describe, expect, it } from 'vitest';
import {
  detectCacheHit,
  evaluateResponseSafety,
  extractPhpWarningFreeJson,
  getHeaderCaseInsensitive,
  isProdRedirectLocation,
} from '../../../src/domain/policies/ResponseSafetyPolicy.ts';

describe('ResponseSafetyPolicy', () => {
  it('le headers de forma case-insensitive', () => {
    expect(getHeaderCaseInsensitive({ Location: 'https://hml.test' }, 'location')).toBe(
      'https://hml.test'
    );
    expect(getHeaderCaseInsensitive({ location: 'https://hml.test' }, 'Location')).toBe(
      'https://hml.test'
    );
    expect(getHeaderCaseInsensitive({}, 'Location')).toBe('');
  });

  it('identifica redirects para PROD', () => {
    expect(isProdRedirectLocation('https://www.palmeiras.com.br/noticias')).toBe(true);
    expect(isProdRedirectLocation('http://Prod-Site-Azion-1627138501.elb.amazonaws.com')).toBe(true);
    expect(isProdRedirectLocation('https://hmlverdao.palmeiras.com.br/')).toBe(false);
    expect(isProdRedirectLocation('')).toBe(false);
  });

  it('detecta cache HIT em headers FastCGI, X-Cache e Age', () => {
    expect(detectCacheHit({ 'X-FastCGI-Cache': 'hit' })).toBe(true);
    expect(detectCacheHit({ 'X-Cache': 'Hit from cloudfront' })).toBe(true);
    expect(detectCacheHit({ Age: '12' })).toBe(true);
    expect(detectCacheHit({ 'X-FastCGI-Cache': 'MISS', Age: '0' })).toBe(false);
    expect(detectCacheHit({})).toBe(false);
  });

  it('extrai JSON valido removendo warnings PHP do WP_DEBUG_DISPLAY', () => {
    const cleanArray = extractPhpWarningFreeJson<number[]>('[{"id":1},{"id":2}]');
    expect(cleanArray).toEqual({
      data: [{ id: 1 }, { id: 2 }],
      warningLeaked: false,
      recordCount: 2,
    });

    const cleanObj = extractPhpWarningFreeJson<{ ok: boolean }>('{"ok":true}');
    expect(cleanObj).toEqual({ data: { ok: true }, warningLeaked: false, recordCount: 1 });

    const withWarningObj = extractPhpWarningFreeJson<{ jogos: number[] }>(
      '<br />\n<b>Warning</b>: undefined constant<br />\n{"jogos":[1]}'
    );
    expect(withWarningObj).toEqual({
      data: { jogos: [1] },
      warningLeaked: true,
      recordCount: 1,
    });

    const withWarningArr = extractPhpWarningFreeJson<number[]>(
      '<b>Notice</b>: test<br />\n[10,20]'
    );
    expect(withWarningArr).toEqual({
      data: [10, 20],
      warningLeaked: true,
      recordCount: 2,
    });

    const onlyWarnings = extractPhpWarningFreeJson('<b>Warning</b>: no json here<br />');
    expect(onlyWarnings).toEqual({ data: null, warningLeaked: true, recordCount: 0 });

    const invalidJson = extractPhpWarningFreeJson('{broken json');
    expect(invalidJson).toEqual({ data: null, warningLeaked: false, recordCount: 0 });

    const empty = extractPhpWarningFreeJson('');
    expect(empty).toEqual({ data: null, warningLeaked: false, recordCount: 0 });

    const primitiveJson = extractPhpWarningFreeJson('123');
    expect(primitiveJson).toEqual({ data: 123, warningLeaked: false, recordCount: 0 });
  });

  it('avalia seguranca completa da resposta HTTP em HML', () => {
    const safeOk = evaluateResponseSafety({
      status: 200,
      headers: { 'X-Cache': 'HIT' },
      body: '{"ok":true}',
      allowKnownHomologRedirect: false,
      allowKnown500: false,
    });
    expect(safeOk.noProdRedirectPassed).toBe(true);
    expect(safeOk.pointsToProd).toBe(false);
    expect(safeOk.cacheHit).toBe(true);
    expect(safeOk.shouldLogFailure).toBe(false);

    const unexpectedProdRedirect = evaluateResponseSafety({
      status: 302,
      headers: { Location: 'https://www.palmeiras.com.br/' },
      body: '',
      allowKnownHomologRedirect: false,
      allowKnown500: false,
    });
    expect(unexpectedProdRedirect.pointsToProd).toBe(true);
    expect(unexpectedProdRedirect.noProdRedirectPassed).toBe(false);
    expect(unexpectedProdRedirect.shouldLogFailure).toBe(true);
    expect(unexpectedProdRedirect.failureReason).toBe('Redirect para PROD detectado');

    const allowedHomologRedirect = evaluateResponseSafety({
      status: 302,
      headers: { location: 'https://www.palmeiras.com.br/' },
      body: '',
      allowKnownHomologRedirect: true,
      allowKnown500: false,
    });
    expect(allowedHomologRedirect.pointsToProd).toBe(true);
    expect(allowedHomologRedirect.noProdRedirectPassed).toBe(true);
    expect(allowedHomologRedirect.shouldLogFailure).toBe(false);

    const rateLimited = evaluateResponseSafety({
      status: 429,
      headers: {},
      body: 'Too Many Requests',
      allowKnownHomologRedirect: false,
      allowKnown500: false,
    });
    expect(rateLimited.rateLimited).toBe(true);
    expect(rateLimited.shouldLogFailure).toBe(true);
    expect(rateLimited.failureReason).toBe('Rate limit 429');

    const deadlockFatal = evaluateResponseSafety({
      status: 500,
      headers: {},
      body: 'Fatal error: Deadlock found when trying to get lock',
      allowKnownHomologRedirect: false,
      allowKnown500: false,
    });
    expect(deadlockFatal.hasPhpOrDbError).toBe(true);
    expect(deadlockFatal.hasDeadlock).toBe(true);
    expect(deadlockFatal.shouldLogFailure).toBe(true);
    expect(deadlockFatal.failureReason).toBe('Erro PHP/DB detectado no body');

    const allowedKnown500WithBody = evaluateResponseSafety({
      status: 500,
      headers: {},
      body: 'Uncaught Error: Undefined constant FOOTSTATS_API',
      allowKnownHomologRedirect: false,
      allowKnown500: true,
    });
    expect(allowedKnown500WithBody.hasPhpOrDbError).toBe(true);
    expect(allowedKnown500WithBody.hasDeadlock).toBe(false);
    expect(allowedKnown500WithBody.serverErrorOrTransportFailure).toBe(true);
    expect(allowedKnown500WithBody.shouldLogFailure).toBe(false);

    const transportZero = evaluateResponseSafety({
      status: 0,
      headers: {},
      body: '',
      allowKnownHomologRedirect: false,
      allowKnown500: false,
    });
    expect(transportZero.serverErrorOrTransportFailure).toBe(true);
    expect(transportZero.shouldLogFailure).toBe(true);
    expect(transportZero.failureReason).toBe('Status 5xx ou erro de transporte');
  });
});
