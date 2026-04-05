#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-}"
if [ -z "$BASE_URL" ]; then
  echo "BASE_URL is required, for example:" >&2
  echo "  BASE_URL=http://your-public-host:80 bash tests/load/run-external-oss-submit-2000-window.sh" >&2
  exit 1
fi

NUM="${NUM:-120}" \
USER_COUNT="${USER_COUNT:-2000}" \
TOTAL_ITERATIONS="${TOTAL_ITERATIONS:-2000}" \
SCENARIO_MODE="${SCENARIO_MODE:-shared-iterations}" \
LOGIN_RETRY_MAX="${LOGIN_RETRY_MAX:-8}" \
LOGIN_RETRY_BACKOFF="${LOGIN_RETRY_BACKOFF:-3}" \
FLOW_RETRY_MAX="${FLOW_RETRY_MAX:-2}" \
THINK_TIME="${THINK_TIME:-1}" \
INCLUDE_VIDEO="${INCLUDE_VIDEO:-false}" \
MAX_DURATION="${MAX_DURATION:-120m}" \
BASE_URL="$BASE_URL" \
bash tests/load/run-external-oss-submit-200.sh
