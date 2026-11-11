#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CANDIDATE="${REPO_ROOT}/.venv/bin/python"

if [[ -x "${CANDIDATE}" ]]; then
  echo "${CANDIDATE}"
  exit 0
fi

command -v python3
