#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

NUM="${NUM:-200}"
BASE_URL="${BASE_URL:-}"
USER_START="${USER_START:-202699990001}"
USER_COUNT="${USER_COUNT:-200}"
PASSWORD_MODE="${PASSWORD_MODE:-last8}"
FIXED_PASSWORD="${FIXED_PASSWORD:-LoadTest@123}"
THINK_TIME="${THINK_TIME:-0.5}"
INCLUDE_VIDEO="${INCLUDE_VIDEO:-false}"
PER_VU_ITERS="${PER_VU_ITERS:-1}"
MAX_DURATION="${MAX_DURATION:-20m}"
PREPARE_FIXTURES="${PREPARE_FIXTURES:-true}"
REPORT_DIR="${REPORT_DIR:-$ROOT_DIR/reports/external-oss-submit-200-$(date '+%Y%m%d-%H%M%S')}"

if [ -z "$BASE_URL" ]; then
  echo "BASE_URL is required, for example:" >&2
  echo "  BASE_URL=http://your-public-host:3000 bash tests/load/run-external-oss-submit-200.sh" >&2
  exit 1
fi

if [ "$PREPARE_FIXTURES" = "true" ]; then
  node scripts/prepare-load-fixtures.js
fi

mkdir -p "$REPORT_DIR"

SUMMARY_JSON="$REPORT_DIR/summary.json"
REPORT_TXT="$REPORT_DIR/report.txt"
LOG_FILE="$REPORT_DIR/k6.log"

run_k6_local() {
  set +e
  k6 run \
    --summary-export "$SUMMARY_JSON" \
    -e BASE_URL="$BASE_URL" \
    -e USER_START="$USER_START" \
    -e USER_COUNT="$USER_COUNT" \
    -e THINK_TIME="$THINK_TIME" \
    -e PASSWORD_MODE="$PASSWORD_MODE" \
    -e FIXED_PASSWORD="$FIXED_PASSWORD" \
    -e FINAL_SUBMIT="true" \
    -e INCLUDE_OPTIONAL_VIDEO="$INCLUDE_VIDEO" \
    -e VUS="$NUM" \
    -e PER_VU_ITERS="$PER_VU_ITERS" \
    -e MAX_DURATION="$MAX_DURATION" \
    tests/load/k6-oss-e2e.js 2>&1 | tee "$LOG_FILE"
  STATUS=${PIPESTATUS[0]}
  set -e
  return "$STATUS"
}

run_k6_docker() {
  set +e
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "$ROOT_DIR:/workspace" \
    -w /workspace \
    grafana/k6 run \
    --summary-export "${SUMMARY_JSON#$ROOT_DIR/}" \
    -e BASE_URL="$BASE_URL" \
    -e USER_START="$USER_START" \
    -e USER_COUNT="$USER_COUNT" \
    -e THINK_TIME="$THINK_TIME" \
    -e PASSWORD_MODE="$PASSWORD_MODE" \
    -e FIXED_PASSWORD="$FIXED_PASSWORD" \
    -e FINAL_SUBMIT="true" \
    -e INCLUDE_OPTIONAL_VIDEO="$INCLUDE_VIDEO" \
    -e VUS="$NUM" \
    -e PER_VU_ITERS="$PER_VU_ITERS" \
    -e MAX_DURATION="$MAX_DURATION" \
    tests/load/k6-oss-e2e.js 2>&1 | tee "$LOG_FILE"
  STATUS=${PIPESTATUS[0]}
  set -e
  return "$STATUS"
}

if command -v k6 >/dev/null 2>&1; then
  run_k6_local
else
  run_k6_docker
fi

node scripts/generate-load-report-text.js "$SUMMARY_JSON" "$REPORT_TXT" "oss-submit-external" "$NUM"
echo "JSON summary: $SUMMARY_JSON"
echo "Text report:  $REPORT_TXT"
