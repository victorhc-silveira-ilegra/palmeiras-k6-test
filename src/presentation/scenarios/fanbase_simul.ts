import { sleep } from 'k6';
import { FanbaseLoadGuardError } from '../../domain/errors/DomainError.ts';
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
    torcida_leitores_noticias: buildPersonaScenario(allocation.newsReaders, 'newsReadersFlow'),
    torcida_dia_de_jogo_tabela: buildPersonaScenario(allocation.matchdayLive, 'matchdayFlow'),
    torcida_buscas_dinamicas: buildPersonaScenario(allocation.searchers, 'searchFlow'),
    torcida_catalogo_midia_lojas: buildPersonaScenario(allocation.catalogMedia, 'catalogFlow'),
    torcida_app_mobile: buildPersonaScenario(allocation.mobileApp, 'mobileAppFlow'),
    torcida_matriz_protocolos: buildPersonaScenario(allocation.protocolMatrix, 'protocolMatrixFlow'),
  },
  thresholds: getThresholdsForScenario('fanbase_simul'),
};

export function setup(): Record<string, unknown> {
  if (!runtime.settings.allowFanbaseLoad) {
    throw new FanbaseLoadGuardError();
  }
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
