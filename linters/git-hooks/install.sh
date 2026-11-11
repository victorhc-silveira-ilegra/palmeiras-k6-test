#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

chmod +x linters/git-hooks/bin/resolve_venv_python.sh linters/git-hooks/bin/python \
  linters/git-hooks/bin/pre-commit linters/git-hooks/commitlint.sh linters/git-hooks/commit-msg \
  linters/git-hooks/pre-commit || true

test -d .venv || python3 -m venv .venv
PYTHON_BIN="$(bash linters/git-hooks/bin/resolve_venv_python.sh)"
"${PYTHON_BIN}" -m pip install -q pre-commit

if [[ -d .git ]]; then
  git config --unset-all core.hooksPath 2>/dev/null || true
  "${PYTHON_BIN}" -m pre_commit install -c .pre-commit-config.yaml
  "${PYTHON_BIN}" -m pre_commit install --hook-type commit-msg -c .pre-commit-config.yaml
fi

echo "[OK] pre-commit hooks instalados com ${PYTHON_BIN}"
echo "[OK] Para rodar em todos os arquivos:"
echo "     make app-pre-commit-run"
echo "     # ou: .venv/bin/pre-commit run --all-files"
echo "     # ou: linters/git-hooks/bin/pre-commit run --all-files"
