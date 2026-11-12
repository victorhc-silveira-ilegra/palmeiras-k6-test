import { describe, expect, it } from 'vitest';
import { TargetEnvironment } from '../../../src/domain/value_objects/TargetEnvironment.ts';
import { ClaimMatchTicketUseCase } from '../../../src/application/use_cases/ClaimMatchTicketUseCase.ts';
import { EvaluateResponseUseCase } from '../../../src/application/use_cases/EvaluateResponseUseCase.ts';
import { HttpRouteClient } from '../../../src/application/use_cases/HttpRouteClient.ts';
import { RunPalmeirasApiUseCase } from '../../../src/application/use_cases/RunPalmeirasApiUseCase.ts';
import { RunWordpressRoutesUseCase } from '../../../src/application/use_cases/RunWordpressRoutesUseCase.ts';
import {
  FixedClock,
  InMemoryEventLogger,
  SpyMetricsRecorder,
  StubHttpTransport,
} from '../../helpers/FakeAdapters.ts';

describe('RunWordpressRoutesUseCase, RunPalmeirasApiUseCase e ClaimMatchTicketUseCase', () => {
  const env = TargetEnvironment.fromName('hml_classic_elb');

  function createHarness(
    responder: ConstructorParameters<typeof StubHttpTransport>[0]
  ): {
    transport: StubHttpTransport;
    metrics: SpyMetricsRecorder;
    logger: InMemoryEventLogger;
    clock: FixedClock;
    wp: RunWordpressRoutesUseCase;
    api: RunPalmeirasApiUseCase;
    claim: ClaimMatchTicketUseCase;
  } {
    const transport = new StubHttpTransport(responder);
    const metrics = new SpyMetricsRecorder();
    const logger = new InMemoryEventLogger();
    const clock = new FixedClock();
    const evaluator = new EvaluateResponseUseCase(metrics, logger);
    const client = new HttpRouteClient(env, transport, metrics, evaluator);
    return {
      transport,
      metrics,
      logger,
      clock,
      wp: new RunWordpressRoutesUseCase(env, client, clock, metrics),
      api: new RunPalmeirasApiUseCase(env, client, clock, metrics),
      claim: new ClaimMatchTicketUseCase(env, client, clock, metrics),
    };
  }

  it('executa todas as rotas WordPress com checks e metricas esperadas', () => {
    const { wp, transport, metrics } = createHarness((req) => {
      if (req.url.endsWith('/check.html')) {
        return { status: 200, body: 'healthy', headers: {}, durationMs: 12 };
      }
      if (req.url.endsWith('/')) {
        return {
          status: 302,
          body: '',
          headers: { Location: 'https://www.palmeiras.com.br/' },
          durationMs: 25,
        };
      }
      if (req.url.includes('wp/v2/search')) {
        return { status: 200, body: '[{"id":1}]', headers: { 'X-Cache': 'HIT' }, durationMs: 30 };
      }
      if (req.url.includes('admin-ajax.php')) {
        return { status: 400, body: '0', headers: {}, durationMs: 18 };
      }
      return { status: 200, body: '[{"id":99}]', headers: {}, durationMs: 22 };
    });

    expect(wp.checkHealth().status).toBe(200);
    expect(wp.viewHomepage().status).toBe(302);
    expect(wp.searchDynamic('abel').status).toBe(200);
    expect(wp.searchWpRest('abel', true, 2, 5).status).toBe(200);
    expect(wp.searchWpRest('abel', false, 1, 1).status).toBe(200);
    expect(wp.fetchWpPosts(174533, true, 1, 2).status).toBe(200);
    expect(wp.fetchWpPosts(null, false, 1, 1).status).toBe(200);
    expect(wp.fetchWpPosts(null, true, 1, 1).status).toBe(200);
    expect(wp.fetchWpPages().status).toBe(200);
    expect(wp.adminHeavyQuerySimulation('sess=1').status).toBe(400);

    expect(transport.requests.some((r) => r.url.includes('nocache='))).toBe(true);
    expect(metrics.dynamicDurations).toHaveLength(1);
    expect(metrics.wpSearchDurations).toHaveLength(2);
    expect(metrics.wpRestDurations).toHaveLength(4);
    expect(metrics.checksHistory.every((c) => Object.values(c).every(Boolean))).toBe(true);
  });

  it('trata JSON invalido na busca WP REST sem quebrar checks', () => {
    const { wp, metrics } = createHarness(() => ({
      status: 200,
      body: 'not-json',
      headers: {},
      durationMs: 10,
    }));
    wp.searchWpRest('invalido', false, 1, 0);
    expect(
      metrics.checksHistory.at(-1)?.['Busca REST (/wp/v2/search): JSON válido (lista)']
    ).toBe(false);
  });

  it('executa todas as rotas customizadas apiverdao/palmeiras/toApp incluindo sondas 401 e 500', () => {
    const { api, metrics } = createHarness((req) => {
      if (req.url.includes('/toApp/')) {
        return { status: 401, body: '{"code":"rest_forbidden"}', headers: {}, durationMs: 15 };
      }
      if (req.url.includes('atendimento') || req.url.includes('jogos-atualizar')) {
        return { status: 500, body: 'Fatal', headers: {}, durationMs: 90 };
      }
      return { status: 200, body: '{"jogos":[{"id":1872}]}', headers: {}, durationMs: 28 };
    });

    expect(api.fetchClassificacao().status).toBe(200);
    expect(api.fetchJogosMes().data?.jogos?.[0]?.id).toBe(1872);
    expect(api.fetchEventosMes().res.status).toBe(200);
    expect(api.fetchEstatisticas().res.status).toBe(200);
    expect(api.fetchSepLojas().res.status).toBe(200);
    expect(api.fetchFotos().res.status).toBe(200);
    expect(api.fetchVideosBase().res.status).toBe(200);
    expect(api.fetchCampeonatos().res.status).toBe(200);
    expect(api.searchNoticiasApi('abel', true, 1, 1).status).toBe(200);
    expect(api.searchNoticiasApi('abel', false, 1, 1).status).toBe(200);
    expect(api.checkToAppAuthGuard().status).toBe(401);
    expect(api.checkAtendimentoEndpoint(true).status).toBe(500);
    expect(api.checkAtendimentoEndpoint(false).status).toBe(500);
    expect(api.checkJogosAtualizarEndpoint(1872, true).status).toBe(500);
    expect(api.checkJogosAtualizarEndpoint(1872, false).status).toBe(500);
    expect(metrics.known500Regressions).toBe(4);
  });

  it('executa ClaimMatchTicketUseCase validando race condition e status sem 500', () => {
    const { claim, metrics } = createHarness(() => ({
      status: 302,
      body: '',
      headers: { Location: 'https://www.palmeiras.com.br/' },
      durationMs: 19,
    }));
    const res = claim.execute('torcedor_1', 'FINAL_COPA_2026', 'CADEIRA_GOL_NORTE_104');
    expect(res.status).toBe(302);
    expect(metrics.checksHistory.at(-1)?.['race_condition_handled']).toBe(true);
    expect(metrics.checksHistory.at(-1)?.['no unhandled 500 error']).toBe(true);
  });
});
