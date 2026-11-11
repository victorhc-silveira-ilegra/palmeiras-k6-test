# Testes de Integração (`tests/integration/`)

Este diretório contém os testes de integração do sistema, responsáveis por validar o comportamento dos adaptadores de infraestrutura, configurações de ambiente, sanitização de logs, datasets JSON reais de HML e o Composition Root.

## Escopo Validado

- `infrastructure/Settings.test.ts`: Validação de valores padrão HML, overrides de ambiente e bloqueio fail-fast para `TARGET_ENV=prod_alb` ou parâmetros numéricos inválidos.
- `infrastructure/SemanticLoggerAdapter.test.ts`: Mascaramento de headers sensíveis (`authorization`, `Cookie`, `api_key`), query strings, tokens `Bearer`, truncamento > 256 caracteres e filtragem por nível/amostragem.
- `infrastructure/K6Adapters.test.ts`: Contrato de `K6HttpTransportAdapter` (`redirects: 0`, `expectedStatuses`), `K6MetricsAdapter`, carregamento real de `data/hml-dataset.json` e `data/fanbase-model.json` no `K6DatasetAdapter`, e saída do `K6ReporterAdapter`.
- `infrastructure/CompositionRoot.test.ts`: Ligação completa em `createRuntimeContainer.ts` e verificação da trava anti-PROD na raiz de composição.

Para os testes unitários das camadas `domain` e `application`, consulte [tests/README.md](../README.md).
