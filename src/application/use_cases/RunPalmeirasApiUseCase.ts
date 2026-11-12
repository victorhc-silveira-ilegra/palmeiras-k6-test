import { JogosMesPayload } from '../../domain/entities/JourneyModels.ts';
import { TargetEnvironment } from '../../domain/value_objects/TargetEnvironment.ts';
import { ClockPort } from '../ports/ClockPort.ts';
import { TransportResponse } from '../ports/HttpTransportPort.ts';
import { MetricsRecorderPort } from '../ports/MetricsRecorderPort.ts';
import { DurationMetricKind, HttpRouteClient } from './HttpRouteClient.ts';

export interface EndpointResult<T> {
  res: TransportResponse;
  data: T | null;
}

export class RunPalmeirasApiUseCase {
  private readonly env: TargetEnvironment;
  private readonly client: HttpRouteClient;
  private readonly clock: ClockPort;
  private readonly metrics: MetricsRecorderPort;

  public constructor(
    env: TargetEnvironment,
    client: HttpRouteClient,
    clock: ClockPort,
    metrics: MetricsRecorderPort
  ) {
    this.env = env;
    this.client = client;
    this.clock = clock;
    this.metrics = metrics;
  }

  public fetchClassificacao(): TransportResponse {
    return this.getJsonEndpoint('/wp-json/apiverdao/v1/futebol/classificacao?champs=1', 'apiverdao_classificacao').res;
  }

  public fetchJogosMes(): EndpointResult<JogosMesPayload> {
    return this.getJsonEndpoint<JogosMesPayload>('/wp-json/apiverdao/v1/jogos-mes', 'apiverdao_jogos_mes');
  }

  public fetchEventosMes(mes = 11, ano = 2026): EndpointResult<unknown> {
    return this.getJsonEndpoint(`/wp-json/apiverdao/v1/eventos-mes?mes=${mes}&ano=${ano}`, 'apiverdao_eventos_mes');
  }

  public fetchEstatisticas(): EndpointResult<unknown> {
    return this.getJsonEndpoint('/wp-json/apiverdao/v1/futebol/estatisticas', 'apiverdao_estatisticas');
  }

  public fetchSepLojas(): EndpointResult<unknown> {
    return this.getJsonEndpoint('/wp-json/apiverdao/v1/sep-lojas', 'apiverdao_sep_lojas');
  }

  public fetchFotos(): EndpointResult<unknown> {
    return this.getJsonEndpoint('/wp-json/palmeiras/v1/fotos', 'palmeiras_fotos');
  }

  public fetchVideosBase(): EndpointResult<unknown> {
    return this.getJsonEndpoint('/wp-json/apiverdao/v1/videos-base', 'apiverdao_videos_base');
  }

  public fetchCampeonatos(): EndpointResult<unknown> {
    return this.getJsonEndpoint('/wp-json/wp/v2/campeonato?per_page=5', 'wp_campeonato');
  }

  public searchNoticiasApi(term: string, cacheBust = false, vu = 0, iter = 0): TransportResponse {
    const suffix = cacheBust ? `&nocache=${this.clock.nowMs()}_${vu}_${iter}` : '';
    return this.getJsonEndpoint(
      `/wp-json/apiverdao/v1/buscar-noticias?q=${encodeURIComponent(term)}&limit=5&paged=1${suffix}`,
      'apiverdao_buscar_noticias',
      'wp_search',
      'wp_search'
    ).res;
  }

  public checkToAppAuthGuard(endpoint = 'noticias'): TransportResponse {
    const res = this.client.execute({
      path: `/wp-json/toApp/v1/${endpoint}`,
      tags: { type: 'security_check', route: `toapp_${endpoint}` },
      routeName: `toapp_${endpoint}`,
      expectedStatuses: [401],
    });
    this.metrics.recordChecks(res, {
      'Segurança App (/toApp): exige autenticação (401)': () => res.status === 401,
    });
    return res;
  }

  public checkAtendimentoEndpoint(allowKnown500 = false): TransportResponse {
    const res = this.client.execute({
      path: '/wp-json/palmeiras/v1/atendimento',
      tags: { type: 'wp_rest', route: 'palmeiras_atendimento' },
      routeName: 'palmeiras_atendimento',
      allowKnown500,
      ...(allowKnown500 ? { expectedStatuses: [200, 500] } : {}),
    });
    if (res.status === 500) {
      this.metrics.incrementKnown500Regression();
    }
    this.metrics.recordChecks(res, {
      'API Atendimento: HTTP 200 (ou 500 mapeado HML)': () =>
        allowKnown500 ? [200, 500].includes(res.status) : res.status === 200,
    });
    return res;
  }

  public checkJogosAtualizarEndpoint(jogoId = 1872, allowKnown500 = true): TransportResponse {
    const res = this.client.execute({
      path: `/wp-json/apiverdao/v1/jogos-atualizar?consultarPlacarAoVivo=true&idjogo=${jogoId}`,
      tags: { type: 'wp_rest', route: 'apiverdao_jogos_atualizar' },
      routeName: 'apiverdao_jogos_atualizar',
      allowKnown500,
      ...(allowKnown500 ? { expectedStatuses: [200, 500] } : {}),
    });
    if (res.status === 500) {
      this.metrics.incrementKnown500Regression();
    }
    this.metrics.recordChecks(res, {
      'API Jogos Atualizar: HTTP 200 (ou 500 mapeado HML)': () =>
        allowKnown500 ? [200, 500].includes(res.status) : res.status === 200,
    });
    return res;
  }

  private getJsonEndpoint<T = unknown>(
    path: string,
    routeTag: string,
    metricType = 'wp_rest',
    durationMetric: DurationMetricKind = 'wp_rest'
  ): EndpointResult<T> {
    const res = this.client.execute({
      path,
      tags: { type: metricType, route: routeTag, env: this.env.name },
      routeName: routeTag,
      recordCache: true,
      durationMetric,
    });
    const parsed = this.client.parseJson<T>(res, routeTag);
    this.metrics.recordChecks(res, {
      [`API ${routeTag}: HTTP 200`]: () => res.status === 200,
      [`API ${routeTag}: JSON válido`]: () => parsed !== null,
    });
    return { res, data: parsed };
  }
}
