# Suíte de Testes (`tests/`)

Suíte automatizada em **Vitest** para o **Palmeiras K6 Test (HML)**, mantendo meta inegociável de **100% de cobertura** com análise de desvios (`branch coverage`).

## Estrutura

- `unit/`: Testes unitários rápidos e isolados para as camadas `domain` (`TargetEnvironment`, `FanbaseAllocation`, `ResponseSafetyPolicy`, `ThresholdCatalog`, `SmokeProfile`) e `application` (`CoreUseCases`, `RoutesUseCases`, `FanbaseJourneysUseCase`, `RunTimeoutDiagnosticUseCase`), utilizando dublês determinísticos de `helpers/FakeAdapters.ts`.
- [integration/](integration/README.md): Testes de integração para `Settings`, `SemanticLoggerAdapter`, adaptadores `k6`, leitura dos datasets reais de HML em `data/` e montagem do Composition Root.
- `operations/`: Testes em Python (`test_hml_alignment.py`, `test_hml_runner.py`) cobrindo o runner HML, manifestos, túneis SSM e compatibilidade de topologia AWS.

## Execução

```bash
# Executa toda a suíte Vitest com cobertura 100%, k6 inspect nos 10 cenários e testes operacionais Python
make app-gate STAGE=test
```

Para a política completa de TDD e cobertura, consulte [.agents/rules/testing-tdd.md](../.agents/rules/testing-tdd.md) e [docs/engineering-typescript.md](../docs/engineering-typescript.md).
