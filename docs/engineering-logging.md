# Engenharia de Observabilidade e Logging Semântico

Diretrizes e especificações técnicas de observabilidade e emissão de logs estruturados no **Palmeiras K6 Test (HML)**.

## 1. Princípios de Observabilidade

1. **Separação entre Relatório Funcional e Log Operacional**: Os resumos de execução gerados por `K6ReporterAdapter` (`reports/summary-*.html` e `.json`) e o `stdout` do `k6` representam métricas funcionais da suíte, enquanto os eventos emitidos via `SemanticLoggerAdapter` registram marcos de ciclo e anomalias HTTP em linha JSON única.
2. **Semântica e Rastreabilidade**: Cada evento segue o padrão estável `<contexto>.<entidade>.<acao>` com timestamp ISO-8601 (`ts`), `level`, `event` e metadados contextuais sanitizados.
3. **Silêncio Operacional em Caminho Feliz**: Ciclos saudáveis emitem apenas o evento inicial `k6.cycle.started` em `setup()`; requisições bem-sucedidas não geram linhas de log, evitando saturação de I/O em alta concorrência.
4. **Isolamento de Camadas**: `src/domain/` e `src/application/` nunca acessam `console` diretamente. A emissão passa exclusivamente pela porta `EventLoggerPort`.

## 2. Níveis de Log e Critérios de Aplicação

| Nível | Critério de Disparo | Exemplo Prático |
| :--- | :--- | :--- |
| **INFO** | Marcos operacionais de início de execução | Início do cenário no `setup()` (`k6.cycle.started`) com alvo HML e escala de VUs |
| **WARN** | Anomalias HTTP ou violações de política de resposta | Redirect inesperado para PROD (`k6.guardrail.prod_blocked`), `429`, fatal PHP/DB ou erro 5xx |
| **ERROR** | Falhas críticas de runtime ou configuração | Abortamento por erro estrutural ou invocação explícita em nível crítico |
| **DEBUG** | Diagnósticos internos habilitados por `LOG_LEVEL=DEBUG` | Remoção de prefixos `Warning`/`Notice` do `WP_DEBUG_DISPLAY` (`k6.response.php_warning_stripped`) |

## 3. Catálogo Canônico de Eventos

| Evento | Nível | Componente Emissor | Campos Principais | Significado |
| :--- | :--- | :--- | :--- | :--- |
| `k6.cycle.started` | `INFO` | Cenários (`setup()`) | `scenario`, `env`, `scale_factor`, `peak_simultaneous_vus` | Cenário inicializado em HML após validação do Composition Root |
| `k6.guardrail.prod_blocked` | `WARN` | `EvaluateResponseUseCase` | `route`, `status`, `location`, `duration_ms`, `reason` | Cabeçalho `Location` apontou para PROD em rota onde redirect não é esperado |
| `k6.response.rate_limited` | `WARN` | `EvaluateResponseUseCase` | `route`, `status`, `duration_ms`, `cache`, `reason` | Resposta HTTP `429 Too Many Requests` recebida da borda ou origem |
| `k6.response.php_fatal` | `WARN` | `EvaluateResponseUseCase` | `route`, `status`, `duration_ms`, `cache`, `reason` | Corpo da resposta apresentou erro fatal PHP, erro de conexão MySQL ou deadlock |
| `k6.response.transport_error` | `WARN` | `EvaluateResponseUseCase` | `route`, `status`, `duration_ms`, `cache`, `reason` | Erro 5xx não esperado ou falha de rede/TLS (`status === 0`) |
| `k6.response.php_warning_stripped` | `DEBUG` | `EvaluateResponseUseCase` | `route`, `status` | Prefixos HTML emitidos por `WP_DEBUG_DISPLAY` removidos antes do `JSON.parse` |

## 4. Artefatos de Saída e Correlação CloudWatch

- **Sumários `k6` (`reports/`)**: Cada execução grava `reports/summary-<env>-<cenario>-<timestamp>.html` e `.json` via [K6ReporterAdapter.ts](../src/infrastructure/k6/K6ReporterAdapter.ts).
- **Correlação AWS HML**: O script [cloudwatch-summary.sh](../scripts/cloudwatch-summary.sh) consulta métricas de CPU da EC2 `homolog` (`i-02b29195a2fdaf1e7`), requisições/latência do Classic ELB `dev-sep-hml`, métricas do cluster `db-sep-1` e últimos eventos do Log Group `/palmeiras/hml/nginx/error`.

## 5. Medidas de Proteção e Sanitização de Dados Sensíveis

Implementadas na função `sanitizeLogFields` de [SemanticLoggerAdapter.ts](../src/infrastructure/logging/SemanticLoggerAdapter.ts):
- **Redação por Chave**: Chaves correspondentes a `authorization`, `cookie`, `token`, `secret`, `password`, `passwd` ou `api_key` têm seus valores substituídos integralmente por `[REDACTED]`.
- **Mascaramento Inline e Query Strings**: Credenciais `Bearer ...` e parâmetros `?token=`, `?key=`, `?secret=` ou `?password=` em URLs são mascarados com `[REDACTED]` antes da serialização.
- **Truncamento de Payloads**: Valores textuais superiores a 256 caracteres recebem sufixo `...[TRUNCATED]`, impedindo vazamento de HTML ou JSON extensos no console.
- **Amostragem Controlada**: Eventos `WARN` e `ERROR` respeitam `LOG_ERRORS` e `LOG_ERROR_SAMPLE_RATE` para evitar inundação de stdout durante rajadas de estresse.
