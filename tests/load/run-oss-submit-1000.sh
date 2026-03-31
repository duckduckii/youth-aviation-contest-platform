#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

REPORT_DIR_DEFAULT="$ROOT_DIR/reports/oss-submit-1000-$(date '+%Y%m%d-%H%M%S')"

bash test.sh \
  -type oss-submit \
  -num "${NUM:-1000}" \
  -env-file "${ENV_FILE:-.env}" \
  -seed "${SEED:-true}" \
  -think-time "${THINK_TIME:-0.2}" \
  -password-mode "${PASSWORD_MODE:-last8}" \
  -fixed-password "${FIXED_PASSWORD:-LoadTest@123}" \
  -include-video "${INCLUDE_VIDEO:-true}" \
  -prepare-fixtures "${PREPARE_FIXTURES:-true}" \
  -per-vu-iters "${PER_VU_ITERS:-1}" \
  -max-duration "${MAX_DURATION:-30m}" \
  -report-dir "${REPORT_DIR:-$REPORT_DIR_DEFAULT}" \
  "$@"
