#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$PROJECT_ROOT/.env.production"
DEFAULT_ENV_FILE="$PROJECT_ROOT/.env.production.default"
DEFAULT_DOCKER_REGISTRY_MIRROR="${DOCKER_REGISTRY_MIRROR:-https://docker.m.daocloud.io}"

cd "$PROJECT_ROOT"

reexec_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    return 0
  fi

  if command -v sudo >/dev/null 2>&1; then
    exec sudo -E sh "$0" "$@"
  fi

  echo '部署需要 root 或 sudo 权限。'
  echo '请使用 root 账号执行 ./deploy/release.sh，或先安装 sudo。'
  exit 1
}

detect_ubuntu() {
  if [ ! -f /etc/os-release ]; then
    return 1
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ]
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return 0
  fi

  od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
}

bootstrap_env_file() {
  if [ -f "$ENV_FILE" ]; then
    return 0
  fi

  if [ ! -f "$DEFAULT_ENV_FILE" ]; then
    echo "缺少默认环境文件：$DEFAULT_ENV_FILE"
    exit 1
  fi

  echo "检测到 .env.production 不存在，正在根据 .env.production.default 自动生成。"
  cp "$DEFAULT_ENV_FILE" "$ENV_FILE"

  session_secret=$(generate_secret)
  db_password=$(generate_secret)
  mysql_root_password=$(generate_secret)
  redis_password=$(generate_secret)

  sed -i \
    -e "s/__AUTO_GENERATE_SESSION_SECRET__/$session_secret/" \
    -e "s/__AUTO_GENERATE_DB_PASSWORD__/$db_password/" \
    -e "s/__AUTO_GENERATE_MYSQL_ROOT_PASSWORD__/$mysql_root_password/" \
    -e "s/__AUTO_GENERATE_REDIS_PASSWORD__/$redis_password/" \
    "$ENV_FILE"

  chmod 600 "$ENV_FILE"

  echo
  echo '已生成 .env.production。默认使用 local 存储，可直接部署。'
  echo '如需 OSS，请编辑根目录 .env.production 后重新执行 ./deploy/release.sh。'
  echo
}

install_ubuntu_base_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y \
    ca-certificates \
    curl \
    git \
    uidmap \
    iptables \
    apt-transport-https \
    gnupg \
    lsb-release \
    python3 \
    nginx
}

install_docker_engine() {
  if command -v docker >/dev/null 2>&1 && docker --version >/dev/null 2>&1; then
    return 0
  fi

  if curl -fsSL https://get.docker.com | sh; then
    return 0
  fi

  apt-get update

  if apt-get install -y docker.io docker-compose-v2; then
    return 0
  fi

  if apt-get install -y docker.io docker-compose-plugin; then
    return 0
  fi

  apt-get install -y docker.io
}

configure_docker_mirror() {
  mkdir -p /etc/docker

  python3 - <<'PY'
import json
import os
from pathlib import Path

mirror = os.environ["DEFAULT_DOCKER_REGISTRY_MIRROR"].strip()
path = Path("/etc/docker/daemon.json")
data = {}

if path.exists():
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        backup = path.with_suffix(".json.bak")
        path.rename(backup)
        data = {}

mirrors = data.get("registry-mirrors", [])
if not isinstance(mirrors, list):
    mirrors = []

merged = []
for item in [mirror, *mirrors]:
    if isinstance(item, str) and item and item not in merged:
        merged.append(item)

data["registry-mirrors"] = merged
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
PY
}

ensure_docker_stack() {
  if command -v docker >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1 \
    && docker info >/dev/null 2>&1; then
    return 0
  fi

  if ! detect_ubuntu; then
    echo '当前机器缺少可用的 Docker / Docker Compose，自动安装仅支持 Ubuntu。'
    exit 1
  fi

  echo '检测到 Docker / Docker Compose 环境未就绪，开始自动安装或修复。'
  install_ubuntu_base_packages
  install_docker_engine
  configure_docker_mirror

  systemctl daemon-reload
  systemctl reset-failed docker.service docker.socket || true
  systemctl enable docker.service docker.socket containerd.service
  systemctl restart containerd.service
  systemctl restart docker.socket
  systemctl restart docker.service

  if ! docker compose version >/dev/null 2>&1; then
    apt-get update
    apt-get install -y docker-compose-v2 || apt-get install -y docker-compose-plugin
  fi

  target_user="${SUDO_USER:-}"
  if [ -n "$target_user" ] && id "$target_user" >/dev/null 2>&1; then
    usermod -aG docker "$target_user" || true
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo 'Docker 安装失败：未检测到 docker 命令。'
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    echo 'Docker Compose 安装失败：未检测到 docker compose。'
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo 'Docker daemon 未就绪，请检查 docker 服务状态。'
    exit 1
  fi
}

apply_host_sysctl() {
  install -D -m 0644 \
    "$PROJECT_ROOT/deploy/sysctl/99-youth-contest-ingress.conf" \
    /etc/sysctl.d/99-youth-contest-ingress.conf
  sysctl --system
}

install_host_nginx() {
  if ! command -v nginx >/dev/null 2>&1; then
    apt-get update
    apt-get install -y nginx
  fi

  install -D -m 0644 \
    "$PROJECT_ROOT/deploy/nginx/host-nginx.conf" \
    /etc/nginx/nginx.conf

  nginx -t
  systemctl enable nginx
  systemctl restart nginx
  systemctl status nginx --no-pager
}

wait_for_container_health() {
  container_name="$1"
  attempts="${2:-30}"
  interval_seconds="${3:-2}"
  i=0

  while [ "$i" -lt "$attempts" ]; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || true)"
    if [ "$status" = "healthy" ]; then
      return 0
    fi

    i=$((i + 1))
    sleep "$interval_seconds"
  done

  echo "容器未在预期时间内进入 healthy 状态：$container_name"
  docker ps --filter "name=$container_name"
  docker logs --tail 100 "$container_name" || true
  exit 1
}

wait_for_http() {
  url="$1"
  attempts="${2:-30}"
  interval_seconds="${3:-2}"
  i=0

  while [ "$i" -lt "$attempts" ]; do
    if curl --noproxy '*' -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi

    i=$((i + 1))
    sleep "$interval_seconds"
  done

  echo "健康检查失败：$url"
  docker logs --tail 100 youth-contest-app || true
  exit 1
}

reexec_as_root "$@"
bootstrap_env_file
ensure_docker_stack

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose --env-file $ENV_FILE"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose --env-file $ENV_FILE"
else
  echo '未检测到 Docker Compose。'
  exit 1
fi

apply_host_sysctl
install_host_nginx

$COMPOSE build app
$COMPOSE up -d mysql redis
$COMPOSE --profile init run --rm app-init
$COMPOSE up -d app
docker rm -f youth-contest-nginx >/dev/null 2>&1 || true
$COMPOSE ps
wait_for_container_health youth-contest-app 30 2

echo
echo '宿主机健康检查：'
wait_for_http http://127.0.0.1:3000/healthz 30 2
curl --noproxy '*' -fsS http://127.0.0.1:3000/healthz
echo
