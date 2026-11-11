import { ScenarioName, ThresholdMap } from '../entities/JourneyModels.ts';

const THRESHOLD_CATALOG: Record<ScenarioName, ThresholdMap> = {
  smoke: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000', 'p(99)<3500'],
    'http_req_duration{route:healthcheck}': ['p(95)<400'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  load: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    'http_req_duration{route:healthcheck}': ['p(95)<500'],
    'http_req_duration{type:wp_rest}': ['p(95)<2500'],
    'http_req_duration{type:wp_search}': ['p(95)<3500'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  api_mix: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<2500', 'p(99)<4000'],
    'http_req_duration{type:wp_rest}': ['p(95)<2500'],
    'http_req_duration{type:wp_search}': ['p(95)<3000'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  fanbase_simul: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<4500', 'p(99)<8000'],
    'http_req_duration{route:healthcheck}': ['p(95)<600'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  stress: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<5000'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  spike: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<4500'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  soak: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<2500', 'p(99)<4000'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  cache_bypass: {
    http_req_failed: ['rate<0.03'],
    http_req_duration: ['p(95)<4000'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
  race_condition: {
    http_req_failed: ['rate<0.01'],
    'checks{check:race_condition_handled}': ['rate>0.99'],
    'checks{check:no_prod_redirect}': ['rate==1'],
  },
};

export function getThresholdsForScenario(scenario: ScenarioName): ThresholdMap {
  return THRESHOLD_CATALOG[scenario];
}
