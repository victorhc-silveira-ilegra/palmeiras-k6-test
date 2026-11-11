# Linters, Git Hooks e Governança de Commits (`linters/`)

Especificação dos padrões de qualidade de código, análise estática e automações de hooks locais do repositório **Palmeiras K6 Test (HML)**.

## 1. Pre-commit e Paridade com CI

A configuração [.pre-commit-config.yaml](../.pre-commit-config.yaml) (e os fallbacks em [.githooks/pre-commit](../.githooks/pre-commit)) espelha exatamente a matriz executada no workflow [ci.yml](../.github/workflows/ci.yml) no padrão `NOME_DA_TECNOLOGIA | NOME_DO_JOB_STEP` via `scripts/operations/clean_workspace.py --area <area> --stage <stage>`:

1. **Commitlint**: [commitlint.config.mjs](commitlint.config.mjs), [git-hooks/install.sh](git-hooks/install.sh) e [git-hooks/commitlint.sh](git-hooks/commitlint.sh) instalam os ganchos `.pre-commit-config.yaml` via `.venv` e validam mensagens em Conventional Commits nos stages `pre-commit` e `commit-msg`.
2. **TypeScript**: `TypeScript | Lint`, `TypeScript | Seguranca`, `TypeScript | Testes` (100% `branch coverage` + `k6 inspect`), `TypeScript | Validate` e `TypeScript | Build`.
3. **Docker**: `Docker | Lint` (`hadolint`), `Docker | Seguranca` (`trivy config`), `Docker | Testes`, `Docker | Validate` e `Docker | Build`.
4. **GitHub**: `GitHub | Lint` (`actionlint`), `GitHub | Seguranca` (`gitleaks`), `GitHub | Testes`, `GitHub | Validate` e `GitHub | Build`.
5. **Scripts**: `Scripts | Lint`, `Scripts | Seguranca`, `Scripts | Testes`, `Scripts | Validate` (`bash -n`) e `Scripts | Build`.

## 2. Instalação e Execução Manual

```bash
make app-pre-commit
make app-pre-commit-run
make app-ci
```

## 3. Regras TypeScript e ESLint ([eslint.config.mjs](../eslint.config.mjs))

- `@typescript-eslint/strict` habilitado em `src/` e `tests/`.
- `@typescript-eslint/no-explicit-any`: erro.
- `@typescript-eslint/explicit-function-return-type`: erro.
- `max-lines`: máximo de 300 linhas por arquivo.
- `no-restricted-imports`: impede `src/domain/` e `src/application/` de importar `k6*`, `node:*`, `infrastructure` ou `presentation`.

## 4. Convenção de Commits

Todas as mensagens de commit seguem **Conventional Commits** em português brasileiro:

- **Tipos Permitidos**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Estrutura**: `<tipo>(<escopo opcional>): <descrição em letras minúsculas>`.
- **Exemplo**: `docs(arquitetura): padroniza documentacao tecnica conforme contrato hexagonal`.
