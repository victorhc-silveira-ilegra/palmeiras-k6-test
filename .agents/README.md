# Harness Universal de Agentes (`.agents/`)

Diretório de governança e procedimentos operacionais padronizados para consumo por agentes autônomos atuando no repositório **Palmeiras K6 Test (HML)**.

## Estrutura

- [rules/architecture.md](rules/architecture.md): Fronteiras das 4 camadas hexagonais, tipagem estrita, limite de 300 linhas e política de zero comentários em `src/`.
- [rules/hml-safety.md](rules/hml-safety.md): Invariante anti-PROD, bloqueio de redirecionamentos (`redirects: 0`) e exigência de `no_prod_redirect` (`rate==1`).
- [rules/observability.md](rules/observability.md): Contrato `logEvent`, catálogo `<contexto>.<entidade>.<acao>` e sanitização obrigatória de dados sensíveis.
- [rules/testing-tdd.md](rules/testing-tdd.md): Fluxo TDD, cobertura de 100% em branches e validação via `k6 inspect`.
- [skills/quality-gate/SKILL.md](skills/quality-gate/SKILL.md): Guia de execução e diagnóstico dos 5 estágios da Matriz de Qualidade Unificada.
- [skills/run-hml-suite/SKILL.md](skills/run-hml-suite/SKILL.md): Manual operacional para execução controlada em HML e correlação CloudWatch.
