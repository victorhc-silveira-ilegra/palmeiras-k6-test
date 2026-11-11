import { sleep } from 'k6';
import { getThresholdsForScenario } from '../../domain/services/ThresholdCatalog.ts';
import { createScenarioRuntime, createScenarioSummary } from './_k6Runtime.ts';

const runtime = createScenarioRuntime();
const allocation = runtime.fanbaseAllocation;
const { rampUp, hold, rampDown } = runtime.settings;

function buildPersonaScenario(targetVus: number, exec: string): Record<string, unknown> {
  return {
    executor: 'ramping-vus',
    startTime: '0s',
    startVUs: 1,
    stages: [
      { duration: rampUp, target: targetVus },
      { duration: hold, target: targetVus },
      { duration: rampDown, target: 0 },
    ],
    exec,
  };
}

export const options = {
  insecureSkipTLSVerify: runtime.settings.environment.insecureSkipTLSVerify,
  scenarios: {
    fanbase_news_readers: buildPersonaScenario(allocation.newsReaders, 'newsReadersFlow'),
    fanbase_matchday_live: buildPersonaScenario(allocation.matchdayLive, 'matchdayFlow'),
    fanbase_searchers: buildPersonaScenario(allocation.searchers, 'searchFlow'),
    fanbase_catalog_media: buildPersonaScenario(allocation.catalogMedia, 'catalogFlow'),
    fanbase_mobile_app: buildPersonaScenario(allocation.mobileApp, 'mobileAppFlow'),
    fanbase_protocol_matrix: buildPersonaScenario(allocation.protocolMatrix, 'protocolMatrixFlow'),
  },
  thresholds: getThresholdsForScenario('fanbase_simul'),
};

export function setup(): Record<string, unknown> {
  const model = runtime.dataset.getFanbaseModel();
  runtime.logger.emit('INFO', 'k6.cycle.started', {
    scenario: 'fanbase_simul',
    env: runtime.settings.environment.name,
    scale_factor: allocation.scaleFactor,
    peak_simultaneous_vus: allocation.totalPeakVUs,
  });
  return {
    fanbaseRange: `${model.fanbase.min_supporters}-${model.fanbase.max_supporters}`,
    scaleFactor: allocation.scaleFactor,
    peakSimultaneousVUs: allocation.totalPeakVUs,
  };
}

export function newsReadersFlow(): void {
  runtime.fanbaseJourneys.runNewsReaderJourney();
  sleep(0.5);
}

export function matchdayFlow(): void {
  runtime.fanbaseJourneys.runMatchdayDataJourney();
  sleep(0.5);
}

export function searchFlow(): void {
  const terms = runtime.dataset.getHmlDataset().search_terms;
  const term = terms[Math.floor(Math.random() * terms.length)] ?? 'palmeiras';
  runtime.fanbaseJourneys.runSearchAndOpenJourney(term);
  sleep(0.5);
}

export function catalogFlow(): void {
  runtime.fanbaseJourneys.runCatalogAndMediaJourney();
  sleep(0.8);
}

export function mobileAppFlow(): void {
  const endpoints = ['noticias', 'elenco', 'calendario'];
  const target = endpoints[__ITER % endpoints.length] ?? 'noticias';
  runtime.palmeirasApi.checkToAppAuthGuard(target);
  sleep(0.5);
}

export function protocolMatrixFlow(): void {
  runtime.fanbaseJourneys.runProtocolAndResponseMatrix();
  sleep(1);
}

export const handleSummary = createScenarioSummary(
  'fanbase_simul',
  runtime.settings.environment.name
);
