---
name: quality-gate
description: Executa e diagnostica a Matriz de Qualidade Unificada de 5 estagios (Lint, Security, Test, Validate, Build) antes de commits ou execucoes em HML.
---

# Execucao do Quality Gate Unificado

1. Execute todos os estagios sequenciais via `python3 scripts/operations/clean_workspace.py --stage all` ou `make all`.
2. Para validar apenas um estagio especifico, utilize `--stage lint`, `--stage security`, `--stage test`, `--stage validate` ou `--stage build`.
3. Em caso de falha no estagio `lint`, verifique `npx tsc --noEmit`, `npx eslint src tests`, limite de 300 linhas e ausencia de comentarios ou emojis em `src/`.
4. Em caso de falha no estagio `test`, inspecione o relatorio de cobertura `v8` para assegurar 100 por cento em linhas, funcoes, statements e branches, alem da validacao de `k6 inspect`.
