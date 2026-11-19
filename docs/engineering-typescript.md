# Engenharia de Software em TypeScript e k6

Diretrizes formais de engenharia de software para o **Palmeiras K6 Test (HML)** cobrindo padrões arquiteturais, tipagem estrita TypeScript, isolamento do runtime `k6 v2.3.0` e garantias de qualidade.

## 1. Princípios de Engenharia e Boas Práticas

1. **Ausência de Comentários no Código**: O código-fonte em `src/` não deve conter comentários explicativos nem blocos JSDoc. A clareza decorre de nomenclatura semântica, tipos explícitos e funções coesas com até 300 linhas por arquivo.
2. **Tipagem Estrita (`tsc --noEmit` + `@typescript-eslint/strict`)**: Todas as assinaturas de funções, métodos e retornos são explicitamente tipadas (`explicit-function-return-type`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). O uso de `any` é bloqueado como erro em tempo de lint.
3. **Imutabilidade e Fail-Fast**: Value Objects (`TargetEnvironment`, `FanbaseAllocation`) validam invariantes no momento da criação via métodos de fábrica estáticos (`create`, `fromName`, `fromScaleFactor`), lançando exceções tipadas de domínio antes de qualquer I/O.
4. **Isolamento de Efeitos Colaterais**: Chamadas a `k6/http`, `k6/metrics`, `k6/data`, relógio (`Date.now()`) e gravação em console residem exclusivamente na camada `src/infrastructure/` e no binding `src/presentation/scenarios/_k6Runtime.ts`.

## 2. Portas e Adaptadores (Ports & Adapters)

Na camada de aplicação (`src/application/ports/`), todas as dependências externas são modeladas como interfaces TypeScript puras:

| Porta (`src/application/ports`) | Adaptador Concreto (`src/infrastructure`) | Finalidade Operacional |
| :--- | :--- | :--- |
| `HttpTransportPort` | `K6HttpTransportAdapter` | Execução HTTP (`GET`, `HEAD`, `OPTIONS`, `POST`) com `redirects: 0` e `expectedStatuses` |
| `MetricsRecorderPort` | `K6MetricsAdapter` | Registro de contadores, rates, trends (`wp_rest_duration`, `wp_search_duration`) e `check` |
| `EventLoggerPort` | `SemanticLoggerAdapter` | Emissão de logs estruturados com redação de credenciais e controle de amostragem |
| `DatasetPort` | `K6DatasetAdapter` | Leitura de `HmlDataset` e `FanbaseModel` carregados via `SharedArray` |
| `ClockPort` | `SystemClockAdapter` | Abstração de timestamp (`nowMs`) e aleatoriedade (`random`) para testes determinísticos |

## 3. Serviços e Políticas de Domínio

### 3.1 Segurança Anti-PROD (`TargetEnvironment`)

O Value Object [TargetEnvironment.ts](../src/domain/value_objects/TargetEnvironment.ts) aceita os 5 alvos HML autorizados: `azion_edge`, `hml_alb`, `hml_ec2_direct`, `ec2_direct` e `hml_classic_elb`. A função `assertNotProd` valida ambiente, URL base, cabeçalhos de host e caminhos dinâmicos retornados em `_links.self`, lançando `ForbiddenProductionTargetError` ao detectar `prod`, `www.palmeiras.com.br` ou `1627138501`.

### 3.2 Avaliação de Segurança e Payloads (`ResponseSafetyPolicy`)

O módulo [ResponseSafetyPolicy.ts](../src/domain/policies/ResponseSafetyPolicy.ts) concentra a avaliação determinística de respostas:
- `getHeaderCaseInsensitive`: normaliza leitura de `Location`, `X-FastCGI-Cache`, `X-Cache` e `Age`.
- `detectCacheHit`: identifica hits de FastCGI ou CDN sem acoplar ao `k6`.
- `extractPhpWarningFreeJson`: detecta e contabiliza prefixos HTML de `Warning`, `Notice` e `Deprecated` gerados por `WP_DEBUG_DISPLAY` em HML antes de extrair e contar os registros JSON válidos.
- `evaluateResponseSafety`: detecta redirect inesperado para PROD, rate limit `429`, erros fatais PHP/DB, deadlocks e falhas 5xx ou `status === 0`.

### 3.3 Catálogo de Thresholds (`ThresholdCatalog`) e Perfis de Smoke (`SmokeProfile`)

O serviço [ThresholdCatalog.ts](../src/domain/services/ThresholdCatalog.ts) fornece os perfis para os 10 cenários (`smoke`, `load`, `api_mix`, `fanbase_simul`, `stress`, `spike`, `soak`, `cache_bypass`, `race_conditions`, `heavy_sync_probe`), garantindo em todos eles a trava `checks{check:no_prod_redirect}: ['rate==1']`. O serviço [SmokeProfile.ts](../src/domain/services/SmokeProfile.ts) calibra a execução entre `functional` (padrão, 2 VUs, 1 iteração por VU, timeout 15s) e `strict` (20s contínuos com limites rígidos de latência).

## 4. Estratégia de Testes e Qualidade

- **Cobertura Integral (100% Branch Coverage)**: A suíte executada via `npx vitest run --coverage` audita `100%` de linhas, instruções, funções e branches em `src/domain/`, `src/application/`, `src/infrastructure/` e `src/presentation/composition/`.
- **Testes Unitários Determinísticos (`tests/unit/`)**: Utilizam implementações em memória (`InMemoryEventLogger`, `SpyMetricsRecorder`, `StubHttpTransport`, `FixedClock`) para cobrir todas as jornadas e fluxos de erro sem rede externa.
- **Testes de Integração (`tests/integration/`)**: Validam carregamento de `Settings`, sanitização de logs, adaptadores HTTP/Métricas/Reporter, leitura real de `data/hml-dataset.json` e `data/fanbase-model.json`, e montagem do `RuntimeContainer`.
- **Testes de Operações (`tests/operations/`)**: Validam runners, túneis SSM e fixtures AWS de HML via `python3 -m unittest discover -s tests/operations`.
- **Inspeção Nativa k6**: Todos os 10 cenários em `src/presentation/scenarios/*.ts` são validados com `k6 inspect`, além do teste negativo obrigatório `k6 inspect -e TARGET_ENV=prod_alb src/presentation/scenarios/smoke.ts`.

## 5. Entrypoints e Execução

Os 10 cenários executam a partir de `src/presentation/scenarios/` gerenciados pelo controlador HML:
- `smoke.ts` — Validação rápida de saúde HML (perfil `functional` ou `strict`).
- `load.ts` — Carga mista REST + busca dinâmica calibrada para HML.
- `api_mix.ts` — Rotação completa dos endpoints `/wp-json/wp/v2/*`, `/wp-json/apiverdao/v1/*`, `/wp-json/palmeiras/v1/*` e guarda `/wp-json/toApp/v1/*`.
- `fanbase_simul.ts` — Simulação simultânea das 6 personas da torcida com `startTime: '0s'` escalada por `SCALE_FACTOR`.
- `stress.ts` e `spike.ts` — Testes de rampa até o limite de capacidade e picos de dia de jogo.
- `soak.ts` — Teste prolongado (`SOAK_DURATION`) para observar consumo de memória e estabilidade.
- `cache_bypass.ts` — Bypass de cache na origem via strings `nocache`.
- `race_conditions.ts` — Contenção concorrente sobre a rota legada `/api/v1/ingressos/claim`.
- `heavy_sync_probe.ts` — Sonda de concorrência com 2 VUs para detecção de timeout síncrono e lock de sessão pós-corte.
