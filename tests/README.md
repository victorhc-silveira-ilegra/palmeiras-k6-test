# Suíte de Testes (`tests/`)

Suíte automatizada em **Vitest** para o **Palmeiras K6 Test (HML)**, mantendo meta inegociável de **100% de cobertura** com análise de desvios (`branch coverage`).

## Estrutura

- `unit/`: Testes unitários rápidos e isolados para as camadas `domain` (`TargetEnvironment`, `FanbaseAllocation`, `ResponseSafetyPolicy`, `ThresholdCatalog`) e `application` (`CoreUseCases`, `RoutesUseCases`, `FanbaseJourneysUseCase`), utilizando dublês determinísticos de `helpers/FakeAdapters.ts`.
- [integration/](integration/README.md): Testes de integração para `Settings`, `SemanticLoggerAdapter`, adaptadores `k6`, leitura dos datasets reais de HML em `data/` e montagem do Composition Root.

## Execução

```bash
# Executa toda a suíte Vitest com cobertura 100% e k6 inspect nos 9 cenários
make test
```

Para a política completa de TDD e cobertura, consulte [.agents/rules/testing-tdd.md](../.agents/rules/testing-tdd.md) e [docs/engineering-typescript.md](../docs/engineering-typescript.md).
