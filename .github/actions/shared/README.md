# Composite Actions Compartilhadas (`.github/actions/shared/`)

Este diretório centraliza ações compostas reutilizáveis entre workflows do **Palmeiras K6 Test (HML)**.

## Ações Disponíveis

- [pipeline-summary/action.yml](pipeline-summary/action.yml): Publica a tabela de status consolidado dos estágios (`Commitlint`, `TypeScript`, `Docker`, `GitHub`, `Scripts` e `Release`) em `$GITHUB_STEP_SUMMARY`.
