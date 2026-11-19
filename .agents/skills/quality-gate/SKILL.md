---
name: quality-gate
description: Executa e diagnostica a Matriz de Qualidade Unificada de 5 estagios (Lint, Security, Test, Validate, Build) antes de commits ou execucoes em HML.
---

# Execucao do Quality Gate Unificado

1. Execute todos os estagios sequenciais via `make app-gate STAGE=all` (ou `make app-ci` / `make all`).
2. Para validar apenas um estagio especifico, utilize `make app-gate STAGE=<estagio>` onde `<estagio>` pode ser: `lint`, `security`, `test`, `validate` ou `build`.
3. Tambem e possivel acionar diretamente o orquestrador Python: `python3 scripts/operations/clean_workspace.py --stage <estagio> --area <area>`.
4. Em caso de falha no estagio `lint`, verifique `npx tsc --noEmit`, `npx eslint src tests`, limite de 300 linhas e ausencia de comentarios ou emojis em `src/`.
5. Em caso de falha no estagio `test`, inspecione o relatorio de cobertura `v8` para assegurar 100 por cento em linhas, funcoes, statements e branches, alem da validacao de `k6 inspect` em todos os 10 cenarios e execucao da suite de testes de operacao `tests/operations/`.
