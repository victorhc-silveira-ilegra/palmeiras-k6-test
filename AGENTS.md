# Diretrizes Canônicas para Agentes Inteligentes

Este repositório expõe um harness universal em [.agents/](.agents/README.md) para orientar LLMs e agentes autônomos que operam sobre o **Palmeiras K6 Test (HML)**.

## Regras Obrigatórias

1. **HML Exclusivo**: Nunca executar, gerar URL ou habilitar alvos de produção (`www.palmeiras.com.br`, `Prod-Site-Azion`, `prod_alb`, `1627138501`). Leia [.agents/rules/hml-safety.md](.agents/rules/hml-safety.md).
2. **Arquitetura Hexagonal e DDD**: Preservar o isolamento das camadas `src/domain/`, `src/application/`, `src/infrastructure/` e `src/presentation/`, zero comentários em `src/`, tipagem estrita TypeScript e limite máximo de 300 linhas por arquivo. Leia [.agents/rules/architecture.md](.agents/rules/architecture.md).
3. **TDD e Cobertura 100%**: Toda alteração de domínio, aplicação ou infraestrutura deve manter 100% de cobertura (`statements`, `branches`, `functions`, `lines`) no Vitest e aprovação em `k6 inspect`. Leia [.agents/rules/testing-tdd.md](.agents/rules/testing-tdd.md).
4. **Observabilidade Semântica**: Emitir eventos exclusivamente via `EventLoggerPort` no padrão `<contexto>.<entidade>.<acao>` com sanitização ativa. Leia [.agents/rules/observability.md](.agents/rules/observability.md).
5. **Matriz de Qualidade (5 Estágios)**: Validar sempre `make all` (`scripts/operations/clean_workspace.py --stage all`) antes de encerrar qualquer tarefa.
