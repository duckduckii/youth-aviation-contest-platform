#!/usr/bin/env sh
set -eu

PROJECT_ROOT="/root/youth-aviation-contest-platform"
STATE_DIR="/var/lib/youth-contest"
STATE_FILE="$STATE_DIR/instance-id"
METADATA_URL="${ALICLOUD_METADATA_URL:-http://100.100.100.200/latest/meta-data/instance-id}"

mkdir -p "$STATE_DIR"

current_instance_id=""
if command -v curl >/dev/null 2>&1; then
  current_instance_id="$(curl --noproxy '*' -fsS --connect-timeout 2 --max-time 5 "$METADATA_URL" 2>/dev/null || true)"
fi

previous_instance_id=""
if [ -f "$STATE_FILE" ]; then
  previous_instance_id="$(cat "$STATE_FILE" 2>/dev/null || true)"
fi

if [ -n "$current_instance_id" ] && [ "$current_instance_id" = "$previous_instance_id" ]; then
  echo "ESS 首启脚本跳过：实例 ID 未变化 ($current_instance_id)"
  exit 0
fi

echo "ESS 首启脚本开始执行，当前实例 ID: ${current_instance_id:-unknown}"
cd "$PROJECT_ROOT"
./deploy/release.sh --role app

if [ -n "$current_instance_id" ]; then
  printf '%s\n' "$current_instance_id" >"$STATE_FILE"
fi

echo "ESS 首启脚本执行完成"
