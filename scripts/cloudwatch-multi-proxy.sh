#!/usr/bin/env bash
set -euo pipefail
exec python3 "$(dirname "${BASH_SOURCE[0]}")/operations/hml_telemetry.py" --metrics-only "${1:-15}"
