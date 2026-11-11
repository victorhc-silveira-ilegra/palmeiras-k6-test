import { describe, expect, it } from 'vitest';
import { ForbiddenProductionTargetError } from '../../../src/domain/errors/DomainError.ts';
import { TargetEnvironment } from '../../../src/domain/value_objects/TargetEnvironment.ts';
import { EvaluateResponseUseCase } from '../../../src/application/use_cases/EvaluateResponseUseCase.ts';
import { HttpRouteClient } from '../../../src/application/use_cases/HttpRouteClient.ts';
import { RunFanbaseJourneysUseCase } from '../../../src/application/use_cases/RunFanbaseJourneysUseCase.ts';
import { RunPalmeirasApiUseCase } from '../../../src/application/use_cases/RunPalmeirasApiUseCase.ts';
import { RunWordpressRoutesUseCase } from '../../../src/application/use_cases/RunWordpressRoutesUseCase.ts';
import {
  FixedClock,
  InMemoryEventLogger,
  SpyMetricsRecorder,
  StubHttpTransport,
} from '../../helpers/FakeAdapters.ts';

describe('RunFanbaseJourneysUseCase', () => {
  const env = TargetEnvironment.fromName('hml_classic_elb');

  function setupUseCase(
    responder: ConstructorParameters<typeof StubHttpTransport>[0]
  ): {
    journeys: RunFanbaseJourneysUseCase;
    transport: StubHttpTransport;
    metrics: SpyMetricsRecorder;
  } {
    const transport = new StubHttpTransport(responder);
    const metrics = new SpyMetricsRecorder();
    const logger = new InMemoryEventLogger();
    const clock = new FixedClock();
    const evaluator = new EvaluateResponseUseCase(metrics, logger);
    const client = new HttpRouteClient(env, transport, metrics, evaluator);
    const wp = new RunWordpressRoutesUseCase(env, client, clock, metrics);
    const api = new RunPalmeirasApiUseCase(env, client, clock, metrics);
    return {
      journeys: new RunFanbaseJourneysUseCase(env, client, wp, api, clock, metrics),
      transport,
      metrics,
    };
  }

  it('executa jornada de leitura de noticias encadeando post, categoria e midia', () => {
    const { journeys, transport, metrics } = setupUseCase((req) => {
      if (req.url.includes('/wp/v2/posts?per_page=8')) {
        return {
          status: 200,
          body: JSON.stringify([{ id: 174533, categories: [3060], featured_media: 555 }]),
          headers: {},
          durationMs: 30,
        };
      }
      if (req.url.includes('/wp/v2/posts/174533')) {
        return {
          status: 200,
          body: JSON.stringify({
            id: 174533,
            title: { rendered: 'Titulo HML' },
            content: { rendered: 'Conteudo' },
          }),
          headers: {},
          durationMs: 25,
        };
      }
      if (req.url.includes('/wp/v2/media/')) {
        return { status: 404, body: '', headers: {}, durationMs: 10 };
      }
      return { status: 200, body: '{"id":3060}', headers: {}, durationMs: 12 };
    });

    journeys.runNewsReaderJourney();
    expect(transport.requests.some((r) => r.url.includes('/wp/v2/categories/3060'))).toBe(true);
    expect(transport.requests.some((r) => r.url.includes('/wp/v2/media/555'))).toBe(true);
    expect(metrics.journeyDurations).toHaveLength(1);
  });

  it('interrompe news reader quando lista de posts vem vazia e processa midia 200 sem categoria', () => {
    const emptyCase = setupUseCase(() => ({ status: 200, body: '[]', headers: {}, durationMs: 10 }));
    emptyCase.journeys.runNewsReaderJourney();
    expect(emptyCase.transport.requests).toHaveLength(1);

    const media200Case = setupUseCase((req) => {
      if (req.url.includes('/wp/v2/posts?per_page=8')) {
        return {
          status: 200,
          body: JSON.stringify([{ id: 10, categories: [], featured_media: 77 }]),
          headers: {},
          durationMs: 10,
        };
      }
      return {
        status: 200,
        body: JSON.stringify({ id: 10, title: { rendered: 'OK' }, content: { rendered: 'Body' } }),
        headers: {},
        durationMs: 10,
      };
    });
    media200Case.journeys.runNewsReaderJourney();
    expect(media200Case.transport.requests.some((r) => r.url.includes('/wp/v2/media/77'))).toBe(
      true
    );
  });

  it('executa jornada matchday e catalog/media completas', () => {
    const { journeys, metrics } = setupUseCase((req) => {
      if (req.url.includes('jogos-mes')) {
        return { status: 200, body: '{"jogos":[{"id":2026}]}', headers: {}, durationMs: 20 };
      }
      if (req.url.includes('jogos-atualizar')) {
        return { status: 500, body: 'FOOTSTATS_API missing', headers: {}, durationMs: 20 };
      }
      return { status: 200, body: '[]', headers: {}, durationMs: 15 };
    });

    journeys.runMatchdayDataJourney();
    journeys.runCatalogAndMediaJourney();
    expect(metrics.journeyDurations).toHaveLength(2);
    expect(metrics.known500Regressions).toBe(1);

    const emptyGames = setupUseCase(() => ({ status: 200, body: '{}', headers: {}, durationMs: 10 }));
    emptyGames.journeys.runMatchdayDataJourney();
    expect(emptyGames.transport.requests.some((r) => r.url.includes('idjogo=1872'))).toBe(true);
  });

  it('executa jornada de busca seguindo _links.self de HML e bloqueando PROD', () => {
    const withSelfHref = setupUseCase((req) => {
      if (req.url.includes('/wp/v2/search')) {
        return {
          status: 200,
          body: JSON.stringify([
            {
              id: 50,
              subtype: 'rdpalmeiras',
              _links: { self: [{ href: 'https://hmlverdao.palmeiras.com.br/wp-json/wp/v2/rdpalmeiras/50' }] },
            },
          ]),
          headers: {},
          durationMs: 15,
        };
      }
      return { status: 200, body: '{"id":50}', headers: {}, durationMs: 10 };
    });
    withSelfHref.journeys.runSearchAndOpenJourney('allianz');
    expect(
      withSelfHref.transport.requests.some((r) => r.url.includes('/wp-json/wp/v2/rdpalmeiras/50'))
    ).toBe(true);

    const withPageFallback = setupUseCase((req) => {
      if (req.url.includes('/wp/v2/search')) {
        return {
          status: 200,
          body: JSON.stringify([{ id: 18425, subtype: 'page' }]),
          headers: {},
          durationMs: 15,
        };
      }
      return { status: 200, body: '{"id":18425}', headers: {}, durationMs: 10 };
    });
    withPageFallback.journeys.runSearchAndOpenJourney('noticias');
    expect(
      withPageFallback.transport.requests.some((r) => r.url.includes('/wp-json/wp/v2/pages/18425'))
    ).toBe(true);

    const withPostFallback = setupUseCase((req) => {
      if (req.url.includes('/wp/v2/search')) {
        return {
          status: 200,
          body: JSON.stringify([{ id: 174533, subtype: 'post' }]),
          headers: {},
          durationMs: 15,
        };
      }
      return { status: 200, body: '{"id":174533}', headers: {}, durationMs: 10 };
    });
    withPostFallback.journeys.runSearchAndOpenJourney('palmeiras');
    expect(
      withPostFallback.transport.requests.some((r) => r.url.includes('/wp-json/wp/v2/posts/174533'))
    ).toBe(true);

    const prodSelfHref = setupUseCase(() => ({
      status: 200,
      body: JSON.stringify([
        {
          id: 99,
          subtype: 'post',
          _links: { self: [{ href: 'https://www.palmeiras.com.br/wp-json/wp/v2/posts/99' }] },
        },
      ]),
      headers: {},
      durationMs: 10,
    }));
    expect(() => prodSelfHref.journeys.runSearchAndOpenJourney('prod')).toThrow(
      ForbiddenProductionTargetError
    );

    const emptySearch = setupUseCase(() => ({
      status: 200,
      body: '[]',
      headers: {},
      durationMs: 10,
    }));
    emptySearch.journeys.runSearchAndOpenJourney('nada');
    expect(emptySearch.transport.requests).toHaveLength(1);
  });

  it('executa matriz completa de metodos e status HTTP em HML', () => {
    const { journeys, transport, metrics } = setupUseCase((req) => {
      if (req.method === 'HEAD' || req.url.endsWith('/check.html')) {
        return { status: 200, body: 'healthy', headers: {}, durationMs: 8 };
      }
      if (req.method === 'OPTIONS') {
        return { status: 200, body: '', headers: {}, durationMs: 8 };
      }
      if (req.headers.Host?.includes('dev-sep-hml')) {
        return {
          status: 301,
          body: '',
          headers: { Location: 'https://hmlverdao.palmeiras.com.br/' },
          durationMs: 9,
        };
      }
      if (req.url.endsWith('/')) {
        return {
          status: 302,
          body: '',
          headers: { Location: 'https://www.palmeiras.com.br/' },
          durationMs: 10,
        };
      }
      if (req.method === 'POST') {
        return { status: 400, body: '0', headers: {}, durationMs: 11 };
      }
      if (req.url.includes('/toApp/')) {
        return { status: 401, body: '{}', headers: {}, durationMs: 11 };
      }
      if (req.url.includes('xmlrpc.php') || req.url.includes('.bak')) {
        return { status: 403, body: 'Forbidden', headers: {}, durationMs: 5 };
      }
      if (req.url.includes('/999999999')) {
        return { status: 404, body: '{}', headers: {}, durationMs: 12 };
      }
      if (req.url.includes('atendimento')) {
        return { status: 500, body: 'Error', headers: {}, durationMs: 14 };
      }
      return { status: 200, body: '', headers: {}, durationMs: 10 };
    });

    journeys.runProtocolAndResponseMatrix();
    expect(transport.requests.map((r) => r.method)).toEqual([
      'HEAD',
      'OPTIONS',
      'GET',
      'GET',
      'POST',
      'GET',
      'GET',
      'GET',
      'GET',
      'GET',
      'GET',
    ]);
    expect(metrics.checksHistory.every((c) => Object.values(c).every(Boolean))).toBe(true);
  });
});
