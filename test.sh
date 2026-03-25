#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

TYPE="baseline"
NUM="50"
START="202699990001"
BASE_URL="http://127.0.0.1:3000"
THINK_TIME="0.5"
ENV_FILE=".env.production"
SEED="true"
PASSWORD_MODE="last8"
FIXED_PASSWORD="LoadTest@123"
K6_NETWORK=""
PER_VU_ITERS="1"
MAX_DURATION="10m"
REPORT_DIR=""

usage() {
  cat <<'EOF'
Usage:
  bash test.sh -type <baseline|oss-save|oss-submit|all|seed-only> -num <N> [options]

Options:
  -type <value>             Test type. Default: baseline
  -num <value>              Number of users/VUs. Default: 50
  -start <value>            Starting registration number. Default: 202699990001
  -base-url <value>         Base URL for app. Default: http://127.0.0.1:3000
  -think-time <value>       Think time in seconds. Default: 0.5
  -env-file <path>          Docker Compose env file. Default: .env.production
  -seed <true|false>        Whether to seed users before test. Default: true
  -password-mode <value>    last8 or fixed. Default: last8
  -fixed-password <value>   Used when password-mode=fixed
  -k6-network <value>       Docker network used by k6 fallback
  -per-vu-iters <value>     Iterations per VU. Default: 1
  -max-duration <value>     Max duration for k6 scenario. Default: 10m
  -report-dir <path>        Output directory for test reports
  -h, --help                Show help

Examples:
  bash test.sh -type baseline -num 50
  bash test.sh -type oss-save -num 50
  bash test.sh -type oss-submit -num 50
  bash test.sh -type all -num 50
  bash test.sh -type seed-only -num 200
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -type)
      TYPE="${2:-}"
      shift 2
      ;;
    -num)
      NUM="${2:-}"
      shift 2
      ;;
    -start)
      START="${2:-}"
      shift 2
      ;;
    -base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    -think-time)
      THINK_TIME="${2:-}"
      shift 2
      ;;
    -env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    -seed)
      SEED="${2:-}"
      shift 2
      ;;
    -password-mode)
      PASSWORD_MODE="${2:-}"
      shift 2
      ;;
    -fixed-password)
      FIXED_PASSWORD="${2:-}"
      shift 2
      ;;
    -k6-network)
      K6_NETWORK="${2:-}"
      shift 2
      ;;
    -per-vu-iters)
      PER_VU_ITERS="${2:-}"
      shift 2
      ;;
    -max-duration)
      MAX_DURATION="${2:-}"
      shift 2
      ;;
    -report-dir)
      REPORT_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

case "$TYPE" in
  baseline|oss-save|oss-submit|all|seed-only)
    ;;
  *)
    echo "Unsupported -type: $TYPE" >&2
    usage
    exit 1
    ;;
esac

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

require_cmd docker
require_cmd node

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" "$@"
}

service_container_id() {
  compose ps -q "$1"
}

service_ip() {
  local service="$1"
  local container_id
  container_id="$(service_container_id "$service")"
  if [ -z "$container_id" ]; then
    echo ""
    return
  fi
  docker inspect "$container_id" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
}

project_network() {
  local app_container
  app_container="$(service_container_id app)"
  if [ -z "$app_container" ]; then
    echo ""
    return
  fi
  docker inspect "$app_container" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' | head -n 1
}

print_header() {
  echo
  echo "== $1 =="
}

timestamp() {
  date '+%Y%m%d-%H%M%S'
}

ensure_services() {
  print_header "Checking services"
  compose ps
  local health
  health="$(compose exec -T app /bin/sh -lc 'wget -qO- http://127.0.0.1:3000/healthz' || true)"
  if [ -z "$health" ]; then
    echo "App health check failed" >&2
    exit 1
  fi
  echo "$health"
}

seed_users() {
  print_header "Seeding users"
  local mysql_ip redis_ip
  mysql_ip="$(service_ip mysql)"
  redis_ip="$(service_ip redis)"
  if [ -z "$mysql_ip" ] || [ -z "$redis_ip" ]; then
    echo "Failed to detect mysql/redis container IPs" >&2
    exit 1
  fi

  DB_HOST="$mysql_ip" \
  REDIS_HOST="$redis_ip" \
  STORAGE_DRIVER=oss \
  DB_PORT=3306 \
  DB_USER=root \
  DB_PASSWORD="$(grep '^DB_PASSWORD=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)" \
  DB_NAME="$(grep '^DB_NAME=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)" \
  REDIS_PORT=6379 \
  REDIS_PASSWORD="$(grep '^REDIS_PASSWORD=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)" \
  REDIS_DB="$(grep '^REDIS_DB=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)" \
  LOAD_USER_COUNT="$NUM" \
  LOAD_USER_START="$START" \
  LOAD_USER_PASSWORD_MODE="$PASSWORD_MODE" \
  LOAD_USER_FIXED_PASSWORD="$FIXED_PASSWORD" \
  node scripts/seed-load-users.js
}

run_k6() {
  local script_name="$1"
  local final_submit="${2:-false}"
  local run_name="$3"
  local report_base summary_json report_txt log_file

  report_base="${REPORT_DIR:-$ROOT_DIR/reports/$(timestamp)-${TYPE}-${NUM}}"
  if [ "$TYPE" = "all" ]; then
    report_base="$report_base/$run_name"
  fi
  mkdir -p "$report_base"

  summary_json="$report_base/summary.json"
  report_txt="$report_base/report.txt"
  log_file="$report_base/k6.log"

  if command -v k6 >/dev/null 2>&1; then
    print_header "Running k6 locally"
    set +e
    k6 run \
      --summary-export "$summary_json" \
      -e BASE_URL="$BASE_URL" \
      -e USER_START="$START" \
      -e USER_COUNT="$NUM" \
      -e THINK_TIME="$THINK_TIME" \
      -e PASSWORD_MODE="$PASSWORD_MODE" \
      -e FIXED_PASSWORD="$FIXED_PASSWORD" \
      -e FINAL_SUBMIT="$final_submit" \
      -e VUS="$NUM" \
      -e PER_VU_ITERS="$PER_VU_ITERS" \
      -e MAX_DURATION="$MAX_DURATION" \
      "$script_name" 2>&1 | tee "$log_file"
    local status=${PIPESTATUS[0]}
    set -e
    node scripts/generate-load-report-text.js "$summary_json" "$report_txt" "$run_name" "$NUM"
    echo "JSON summary: $summary_json"
    echo "Text report:  $report_txt"
    return "$status"
  fi

  print_header "Running k6 via Docker"
  local network target_url
  network="${K6_NETWORK:-$(project_network)}"
  if [ -z "$network" ]; then
    echo "Failed to detect Docker network for k6 fallback" >&2
    exit 1
  fi

  target_url="$BASE_URL"
  if [ "$BASE_URL" = "http://127.0.0.1:3000" ] || [ "$BASE_URL" = "http://localhost:3000" ]; then
    target_url="http://app:3000"
  fi

  set +e
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    --network "$network" \
    -v "$ROOT_DIR:/workspace" \
    -w /workspace \
    grafana/k6 run \
    --summary-export "${summary_json#$ROOT_DIR/}" \
    -e BASE_URL="$target_url" \
    -e USER_START="$START" \
    -e USER_COUNT="$NUM" \
    -e THINK_TIME="$THINK_TIME" \
    -e PASSWORD_MODE="$PASSWORD_MODE" \
    -e FIXED_PASSWORD="$FIXED_PASSWORD" \
    -e FINAL_SUBMIT="$final_submit" \
    -e VUS="$NUM" \
    -e PER_VU_ITERS="$PER_VU_ITERS" \
    -e MAX_DURATION="$MAX_DURATION" \
    "$script_name" 2>&1 | tee "$log_file"
  local status=${PIPESTATUS[0]}
  set -e
  node scripts/generate-load-report-text.js "$summary_json" "$report_txt" "$run_name" "$NUM"
  echo "JSON summary: $summary_json"
  echo "Text report:  $report_txt"
  return "$status"
}

run_baseline() {
  print_header "Baseline test"
  run_k6 "tests/load/k6-sign-only.js" "false" "baseline"
}

run_oss_save() {
  print_header "OSS save-draft test"
  run_k6 "tests/load/k6-oss-e2e.js" "false" "oss-save"
}

run_oss_submit() {
  print_header "OSS final-submit test"
  run_k6 "tests/load/k6-oss-e2e.js" "true" "oss-submit"
}

print_summary() {
  print_header "Summary"
  echo "type=$TYPE"
  echo "num=$NUM"
  echo "start=$START"
  echo "base_url=$BASE_URL"
  echo "think_time=$THINK_TIME"
  echo "seed=$SEED"
  echo "password_mode=$PASSWORD_MODE"
  echo "per_vu_iters=$PER_VU_ITERS"
  echo "max_duration=$MAX_DURATION"
  echo "report_dir=${REPORT_DIR:-$ROOT_DIR/reports}"
}

ensure_services

if [ "$SEED" = "true" ]; then
  seed_users
fi

case "$TYPE" in
  baseline)
    run_baseline
    ;;
  oss-save)
    run_oss_save
    ;;
  oss-submit)
    run_oss_submit
    ;;
  all)
    run_baseline
    run_oss_save
    run_oss_submit
    ;;
  seed-only)
    :
    ;;
esac

print_summary
