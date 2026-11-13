import { ScenarioName, ThresholdMap } from '../entities/JourneyModels.ts';

const THRESHOLD_CATALOG: Record<ScenarioName, ThresholdMap> = {
  smoke: {
    iterations: ['count>=1'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000', 'p(99)<3500'],
    'http_req_duration{route:healthcheck}': ['p(95)<400'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  load: {
    'checks{check:no_prod_redirect}': ['rate==1'],
    'http_req_duration{route:healthcheck}': ['p(95)<500'],
  },
  api_mix: {
    http_req_failed: ['rate<0.05'],
    'http_req_duration{type:wp_rest}': ['p(95)<5000'],
    'http_req_duration{type:wp_search}': ['p(95)<8000'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  fanbase_simul: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<4500', 'p(99)<8000'],
    'http_req_duration{route:healthcheck}': ['p(95)<600'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  stress: {
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  spike: {
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  soak: {
    http_req_failed: ['rate<0.05'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  cache_bypass: {
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  race_condition: {
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  heavy_sync_probe: {
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
};

export function getThresholdsForScenario(scenario: ScenarioName): ThresholdMap {
  return THRESHOLD_CATALOG[scenario];
}
