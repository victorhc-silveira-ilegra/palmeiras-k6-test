import { DatasetPort } from '../../application/ports/DatasetPort.ts';
import { EventLoggerPort } from '../../application/ports/EventLoggerPort.ts';
import { ClaimMatchTicketUseCase } from '../../application/use_cases/ClaimMatchTicketUseCase.ts';
import { EvaluateResponseUseCase } from '../../application/use_cases/EvaluateResponseUseCase.ts';
import { HttpRouteClient } from '../../application/use_cases/HttpRouteClient.ts';
import { RunFanbaseJourneysUseCase } from '../../application/use_cases/RunFanbaseJourneysUseCase.ts';
import { RunPalmeirasApiUseCase } from '../../application/use_cases/RunPalmeirasApiUseCase.ts';
import { RunTimeoutDiagnosticUseCase } from '../../application/use_cases/RunTimeoutDiagnosticUseCase.ts';
import { RunWordpressRoutesUseCase } from '../../application/use_cases/RunWordpressRoutesUseCase.ts';
import { FanbaseModel, HmlDataset } from '../../domain/entities/JourneyModels.ts';
import { FanbaseAllocation } from '../../domain/value_objects/FanbaseAllocation.ts';
import { EnvRecord, RuntimeSettings, loadSettings } from '../../infrastructure/config/Settings.ts';
import { K6DatasetAdapter } from '../../infrastructure/k6/K6DatasetAdapter.ts';
import {
  K6HttpClientLike,
  K6HttpTransportAdapter,
} from '../../infrastructure/k6/K6HttpTransportAdapter.ts';
import { K6MetricBindings, K6MetricsAdapter } from '../../infrastructure/k6/K6MetricsAdapter.ts';
import { SemanticLoggerAdapter } from '../../infrastructure/logging/SemanticLoggerAdapter.ts';
import { SystemClockAdapter } from '../../infrastructure/repositories/SystemClockAdapter.ts';

export interface CompositionDependencies {
  envSource: EnvRecord;
  k6Http: K6HttpClientLike;
  k6Metrics: K6MetricBindings;
  loadDataset: () => HmlDataset;
  loadFanbaseModel: () => FanbaseModel;
}

export interface RuntimeContainer {
  settings: RuntimeSettings;
  fanbaseAllocation: FanbaseAllocation;
  logger: EventLoggerPort;
  dataset: DatasetPort;
  wpRoutes: RunWordpressRoutesUseCase;
  palmeirasApi: RunPalmeirasApiUseCase;
  fanbaseJourneys: RunFanbaseJourneysUseCase;
  claimTicket: ClaimMatchTicketUseCase;
  timeoutDiagnostic: RunTimeoutDiagnosticUseCase;
}

export function createRuntimeContainer(deps: CompositionDependencies): RuntimeContainer {
  const settings = loadSettings(deps.envSource);
  const fanbaseAllocation = FanbaseAllocation.fromScaleFactor(settings.scaleFactor);
  const logger = new SemanticLoggerAdapter(console, {
    minLevel: settings.logLevel,
    logErrors: settings.logErrors,
    sampleRate: settings.logErrorSampleRate,
  });
  const clock = new SystemClockAdapter();
  const transport = new K6HttpTransportAdapter(deps.k6Http);
  const metrics = new K6MetricsAdapter(deps.k6Metrics);
  const evaluator = new EvaluateResponseUseCase(metrics, logger);
  const client = new HttpRouteClient(settings.environment, transport, metrics, evaluator);
  const wpRoutes = new RunWordpressRoutesUseCase(settings.environment, client, clock, metrics);
  const palmeirasApi = new RunPalmeirasApiUseCase(settings.environment, client, clock, metrics);
  const fanbaseJourneys = new RunFanbaseJourneysUseCase(
    settings.environment,
    client,
    wpRoutes,
    palmeirasApi,
    clock,
    metrics
  );
  const claimTicket = new ClaimMatchTicketUseCase(settings.environment, client, clock, metrics);
  const timeoutDiagnostic = new RunTimeoutDiagnosticUseCase(
    settings.environment,
    client,
    clock,
    metrics,
    logger
  );
  const dataset = new K6DatasetAdapter(deps.loadDataset, deps.loadFanbaseModel);

  return {
    settings,
    fanbaseAllocation,
    logger,
    dataset,
    wpRoutes,
    palmeirasApi,
    fanbaseJourneys,
    claimTicket,
    timeoutDiagnostic,
  };
}
