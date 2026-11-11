# Código-Fonte (`src/`)

Estrutura de código-fonte do **Palmeiras K6 Test (HML)** organizada segundo **Arquitetura Hexagonal (Ports & Adapters)** e **Domain-Driven Design (DDD)** em TypeScript (`strict: true`).

## Camadas

1. `domain/`: Núcleo puro de regras de negócio, Value Objects (`TargetEnvironment`, `FanbaseAllocation`), política de resposta (`ResponseSafetyPolicy`), catálogo de thresholds (`ThresholdCatalog`) e modelos canônicos (`JourneyModels`). Zero dependências de `k6` ou `node:*`.
2. `application/`: Contratos abstratos em `ports/` (`HttpTransportPort`, `MetricsRecorderPort`, `EventLoggerPort`, `DatasetPort`, `ClockPort`) e casos de uso em `use_cases/` (`RunWordpressRoutesUseCase`, `RunPalmeirasApiUseCase`, `RunFanbaseJourneysUseCase`, `ClaimMatchTicketUseCase`, `EvaluateResponseUseCase`, `HttpRouteClient`, `ResolveEnvironmentUseCase`).
3. `infrastructure/`: Implementações concretas das portas para runtime `k6` (`K6HttpTransportAdapter`, `K6MetricsAdapter`, `K6DatasetAdapter`, `K6ReporterAdapter`), leitor de ambiente (`Settings`), observabilidade semântica (`SemanticLoggerAdapter`) e relógio (`SystemClockAdapter`).
4. `presentation/`: Composition Root único ([createRuntimeContainer.ts](presentation/composition/createRuntimeContainer.ts)), binding `k6` ([_k6Runtime.ts](presentation/scenarios/_k6Runtime.ts)) e os 9 cenários declarativos em `scenarios/*.ts`.
5. `types/`: Declarações de tipagem estrita para módulos nativos do `k6` (`k6.d.ts`).

Para mais detalhes teóricos e diagramas, consulte [docs/arquitetura.md](../docs/arquitetura.md) e [docs/engineering-typescript.md](../docs/engineering-typescript.md).
