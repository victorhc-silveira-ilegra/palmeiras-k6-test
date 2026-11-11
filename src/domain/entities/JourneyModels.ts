export type EnvironmentName = 'hml_classic_elb' | 'hml_alb' | 'azion_edge';

export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST';

export type ScenarioName =
  | 'smoke'
  | 'load'
  | 'api_mix'
  | 'fanbase_simul'
  | 'stress'
  | 'spike'
  | 'soak'
  | 'cache_bypass'
  | 'race_condition';

export type ThresholdMap = Record<string, string[]>;

export type HeaderMap = Record<string, string | undefined>;

export interface WpPostItem {
  id: number;
  slug: string;
  path: string;
}

export interface WpPageItem {
  id: number;
  slug: string;
  path: string;
}

export interface WpCategoryItem {
  id: number;
  slug: string;
  count: number;
}

export interface HmlDataset {
  generated_at_env: string;
  host_header: string;
  posts: WpPostItem[];
  pages: WpPageItem[];
  categories: WpCategoryItem[];
  search_terms: string[];
  rest_endpoints_public: string[];
}

export interface FanbaseModel {
  club: string;
  environment: string;
  fanbase: {
    min_supporters: number;
    max_supporters: number;
    avg_supporters: number;
    brazil_preference_pct_min: number;
    brazil_preference_pct_max: number;
  };
  traffic_persona_weights: {
    news_readers_pct: number;
    matchday_live_table_pct: number;
    dynamic_searchers_pct: number;
    catalog_media_stores_pct: number;
    mobile_app_toapp_pct: number;
    protocol_edge_matrix_pct: number;
  };
  hml_infra_limits: {
    ec2_instance_type: string;
    vcpus: number;
    ram_mb: number;
    php_fpm_max_children: number;
    port_84_fastcgi_cache: boolean;
  };
}

export interface WpPostDetailPayload {
  id: number;
  categories?: number[];
  featured_media?: number;
  title?: { rendered?: string };
  content?: { rendered?: string };
}

export interface SearchHitPayload {
  id?: number;
  subtype?: string;
  _links?: {
    self?: Array<{ href?: string }>;
  };
}

export interface JogosMesPayload {
  jogos?: Array<{ id?: number }>;
}

export interface SafetyEvaluationInput {
  status: number;
  headers: HeaderMap;
  body: string;
  allowKnownHomologRedirect: boolean;
  allowKnown500: boolean;
}

export interface SafetyEvaluationResult {
  location: string;
  pointsToProd: boolean;
  noProdRedirectPassed: boolean;
  rateLimited: boolean;
  hasPhpOrDbError: boolean;
  hasDeadlock: boolean;
  serverErrorOrTransportFailure: boolean;
  cacheHit: boolean;
  shouldLogFailure: boolean;
  failureReason: string;
}
