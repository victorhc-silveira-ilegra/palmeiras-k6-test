import {
  SearchHitPayload,
  WpPostDetailPayload,
} from '../../domain/entities/JourneyModels.ts';
import { getHeaderCaseInsensitive } from '../../domain/policies/ResponseSafetyPolicy.ts';
import { TargetEnvironment, assertNotProd } from '../../domain/value_objects/TargetEnvironment.ts';
import { ClockPort } from '../ports/ClockPort.ts';
import { MetricsRecorderPort } from '../ports/MetricsRecorderPort.ts';
import { HttpRouteClient } from './HttpRouteClient.ts';
import { RunPalmeirasApiUseCase } from './RunPalmeirasApiUseCase.ts';
import { RunWordpressRoutesUseCase } from './RunWordpressRoutesUseCase.ts';

function resolveSearchItemPath(hit: SearchHitPayload): string {
  const selfHref = hit._links?.self?.[0]?.href ?? '';
  if (selfHref.startsWith('https://hmlverdao.palmeiras.com.br/')) {
    return selfHref.replace('https://hmlverdao.palmeiras.com.br', '');
  }
  const resource = hit.subtype === 'page' ? 'pages' : 'posts';
  return `/wp-json/wp/v2/${resource}/${hit.id}`;
}

export class RunFanbaseJourneysUseCase {
  private readonly env: TargetEnvironment;
  private readonly client: HttpRouteClient;
  private readonly wp: RunWordpressRoutesUseCase;
  private readonly api: RunPalmeirasApiUseCase;
  private readonly clock: ClockPort;
  private readonly metrics: MetricsRecorderPort;

  public constructor(
    env: TargetEnvironment,
    client: HttpRouteClient,
    wp: RunWordpressRoutesUseCase,
    api: RunPalmeirasApiUseCase,
    clock: ClockPort,
    metrics: MetricsRecorderPort
  ) {
    this.env = env;
    this.client = client;
    this.wp = wp;
    this.api = api;
    this.clock = clock;
    this.metrics = metrics;
  }

  public runNewsReaderJourney(): void {
    const started = this.clock.nowMs();
    const listRes = this.client.execute({
      path: '/wp-json/wp/v2/posts?per_page=8',
      tags: { type: 'wp_rest', route: 'journey_posts_list', env: this.env.name },
      routeName: 'journey_posts_list',
      durationMetric: 'wp_rest',
    });
    const posts = this.client.parseJson<WpPostDetailPayload[]>(listRes, 'journey_posts_list');
    const picked = Array.isArray(posts) && posts.length > 0
      ? posts[Math.floor(this.clock.random() * posts.length)]
      : undefined;

    this.metrics.recordChecks(listRes, {
      'journey posts list 200': () => listRes.status === 200,
      'journey posts list parsed': () => picked !== undefined,
    });
    if (!picked) {
      return;
    }

    const postRes = this.client.execute({
      path: `/wp-json/wp/v2/posts/${picked.id}`,
      tags: { type: 'wp_rest', route: 'journey_post_detail' },
      routeName: 'journey_post_detail',
      durationMetric: 'wp_rest',
    });
    const postJson = this.client.parseJson<WpPostDetailPayload>(postRes, 'journey_post_detail');
    this.metrics.recordChecks(postRes, {
      'journey post detail 200': () => postRes.status === 200,
      'journey post title & content processed': () =>
        Boolean(postJson?.title?.rendered && postJson.content),
    });

    const firstCategory = picked.categories?.[0];
    if (firstCategory !== undefined) {
      const catRes = this.client.execute({
        path: `/wp-json/wp/v2/categories/${firstCategory}`,
        tags: { type: 'wp_rest', route: 'journey_post_category' },
        routeName: 'journey_post_category',
      });
      this.client.parseJson(catRes, 'journey_post_category');
    }

    if (picked.featured_media && picked.featured_media > 0) {
      const mediaRes = this.client.execute({
        path: `/wp-json/wp/v2/media/${picked.featured_media}`,
        tags: { type: 'wp_rest', route: 'journey_post_media' },
        routeName: 'journey_post_media',
        expectedStatuses: [200, 401, 404],
      });
      if (mediaRes.status === 200) {
        this.client.parseJson(mediaRes, 'journey_post_media');
      }
    }

    this.metrics.recordJourneyProcessingDuration(this.clock.nowMs() - started);
  }

  public runMatchdayDataJourney(): void {
    const started = this.clock.nowMs();
    const { res, data } = this.api.fetchJogosMes();
    const jogos = data?.jogos ?? [];
    this.metrics.recordChecks(res, {
      'matchday jogos list parsed': () => jogos.length > 0,
    });

    const sampleJogo = jogos[Math.floor(this.clock.random() * jogos.length)];
    this.api.fetchClassificacao();
    this.api.fetchEstatisticas();
    this.api.fetchCampeonatos();
    this.api.checkJogosAtualizarEndpoint(sampleJogo?.id ?? 1872, true);
    this.metrics.recordJourneyProcessingDuration(this.clock.nowMs() - started);
  }

  public runSearchAndOpenJourney(term: string): void {
    const started = this.clock.nowMs();
    const searchRes = this.client.execute({
      path: `/wp-json/wp/v2/search?search=${encodeURIComponent(term)}`,
      tags: { type: 'wp_search', route: 'journey_search' },
      routeName: 'journey_search',
    });
    const results = this.client.parseJson<SearchHitPayload[]>(searchRes, 'journey_search');
    this.metrics.recordChecks(searchRes, {
      'journey search 200': () => searchRes.status === 200,
      'journey search parsed array': () => Array.isArray(results),
    });

    const first = results?.[0];
    if (first?.id) {
      const itemPath = resolveSearchItemPath(first);
      assertNotProd(first._links?.self?.[0]?.href ?? itemPath, 'journey_search_self_href');
      const itemRes = this.client.execute({
        path: itemPath,
        tags: { type: 'wp_rest', route: 'journey_search_open_item' },
        routeName: 'journey_search_open_item',
      });
      this.client.parseJson(itemRes, 'journey_search_open_item');
      this.metrics.recordChecks(itemRes, {
        'journey search item 200': () => itemRes.status === 200,
      });
    }

    this.metrics.recordJourneyProcessingDuration(this.clock.nowMs() - started);
  }

  public runCatalogAndMediaJourney(): void {
    const started = this.clock.nowMs();
    this.api.fetchEventosMes();
    this.api.fetchSepLojas();
    this.api.fetchFotos();
    this.api.fetchVideosBase();
    this.metrics.recordJourneyProcessingDuration(this.clock.nowMs() - started);
  }

  public runProtocolAndResponseMatrix(): void {
    const headRes = this.client.execute({
      method: 'HEAD',
      path: '/check.html',
      tags: { type: 'matrix', route: 'head_health' },
      routeName: 'head_health',
    });
    this.metrics.recordChecks(headRes, { 'matrix HEAD 200': () => headRes.status === 200 });

    const optRes = this.client.execute({
      method: 'OPTIONS',
      path: '/wp-json/wp/v2/posts?per_page=1',
      tags: { type: 'matrix', route: 'options_cors' },
      routeName: 'options_cors',
    });
    this.metrics.recordChecks(optRes, { 'matrix OPTIONS 200': () => optRes.status === 200 });

    const canonRes = this.client.execute({
      path: '/',
      tags: { type: 'matrix', route: 'get_301_canonical' },
      routeName: 'get_301_canonical',
      extraHeaders: { Host: 'dev-sep-hml-160178191.us-east-1.elb.amazonaws.com' },
    });
    this.metrics.recordChecks(canonRes, {
      'matrix GET 301 canonical to hmlverdao': () =>
        canonRes.status === 301 &&
        getHeaderCaseInsensitive(canonRes.headers, 'Location').includes('hmlverdao.palmeiras.com.br'),
    });

    this.wp.viewHomepage();

    const postRes = this.client.execute({
      method: 'POST',
      path: '/wp-admin/admin-ajax.php',
      body: 'action=check_core_updates',
      extraHeaders: { 'Content-Type': 'application/x-www-form-urlencoded' },
      tags: { type: 'matrix', route: 'post_400_admin_ajax' },
      routeName: 'post_400_admin_ajax',
      expectedStatuses: [200, 400],
    });
    this.metrics.recordChecks(postRes, { 'matrix POST admin-ajax 400': () => postRes.status === 400 });

    this.api.checkToAppAuthGuard('noticias');

    const xmlrpcRes = this.client.execute({
      path: '/xmlrpc.php',
      tags: { type: 'matrix', route: 'get_403_security' },
      routeName: 'get_403_xmlrpc',
      expectedStatuses: [403],
    });
    const bakRes = this.client.execute({
      path: '/wp-config.php.bak',
      tags: { type: 'matrix', route: 'get_403_security' },
      routeName: 'get_403_bak',
      expectedStatuses: [403],
    });
    this.metrics.recordChecks(xmlrpcRes, { 'matrix GET xmlrpc 403': () => xmlrpcRes.status === 403 });
    this.metrics.recordChecks(bakRes, { 'matrix GET bak 403': () => bakRes.status === 403 });

    const nfRes = this.client.execute({
      path: '/wp-json/wp/v2/posts/999999999',
      tags: { type: 'matrix', route: 'get_404_not_found' },
      routeName: 'get_404_not_found',
      expectedStatuses: [404],
    });
    this.metrics.recordChecks(nfRes, { 'matrix GET 404': () => nfRes.status === 404 });

    this.api.checkAtendimentoEndpoint(true);
    this.wp.checkHealth();
  }
}
