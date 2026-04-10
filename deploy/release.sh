#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$PROJECT_ROOT/.env"
LEGACY_ENV_FILE="$PROJECT_ROOT/.env.production"
INSTANCE_ENV_FILE="$PROJECT_ROOT/.env.instance"
DEFAULT_ENV_FILE="$PROJECT_ROOT/.env.example"
LOCAL_ENV_TEMPLATE="$PROJECT_ROOT/deploy/templates/env.docker.local.example"
DEFAULT_DOCKER_REGISTRY_MIRROR="${DOCKER_REGISTRY_MIRROR:-https://docker.m.daocloud.io}"
MODE="cloud"
ROLE="export"
RUN_DB_INIT=0
RUN_DB_SEED=0
export DEFAULT_DOCKER_REGISTRY_MIRROR

cd "$PROJECT_ROOT"

usage() {
  cat <<'EOF'
用法：
  ./deploy/release.sh [--local] [--role app|export] [--init-db] [--seed-demo]

默认行为：
  - 不带参数时：cloud + oss + export 角色
  - --local：本地调试模式，启动 mysql/redis，本地文件存储
  - --role app：普通业务节点，适合 ESS 扩容节点
  - --role export：导出节点，适合包月 ECS
  - --init-db：执行数据库初始化
  - --seed-demo：写入演示账号（会重置演示账号相关报名数据）
EOF
}

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

  if [ "$MODE" = "local" ]; then
    template="$LOCAL_ENV_TEMPLATE"
  else
    template="$DEFAULT_ENV_FILE"
  fi

  if [ -f "$LEGACY_ENV_FILE" ]; then
    echo "检测到旧配置文件 $(basename "$LEGACY_ENV_FILE")，正在迁移为带注释的 $(basename "$ENV_FILE")。"
    if [ ! -f "$template" ]; then
      echo "缺少环境模板：$template"
      exit 1
    fi

    python3 - "$LEGACY_ENV_FILE" "$template" "$ENV_FILE" <<'PY'
import re
import sys
from pathlib import Path

legacy_path = Path(sys.argv[1])
template_path = Path(sys.argv[2])
output_path = Path(sys.argv[3])

legacy_values = {}
for raw_line in legacy_path.read_text().splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in raw_line:
        continue
    key, value = raw_line.split("=", 1)
    legacy_values[key.strip()] = value

rendered = []
for raw_line in template_path.read_text().splitlines():
    if "=" not in raw_line or raw_line.lstrip().startswith("#"):
        rendered.append(raw_line)
        continue

    key, value = raw_line.split("=", 1)
    normalized_key = key.strip()
    if re.fullmatch(r"[A-Z0-9_]+", normalized_key) and normalized_key in legacy_values:
        rendered.append(f"{normalized_key}={legacy_values[normalized_key]}")
    else:
        rendered.append(raw_line)

output_path.write_text("\n".join(rendered) + "\n")
PY

    chmod 600 "$ENV_FILE"
    return 0
  fi

  if [ ! -f "$template" ]; then
    echo "缺少环境模板：$template"
    exit 1
  fi

  echo "检测到 $(basename "$ENV_FILE") 不存在，正在根据 $(basename "$template") 自动生成。"
  cp "$template" "$ENV_FILE"

  session_secret=$(generate_secret)
  mysql_root_password=$(generate_secret)
  redis_password=$(generate_secret)
  db_password=$(generate_secret)

  sed -i \
    -e "s/__AUTO_GENERATE_SESSION_SECRET__/$session_secret/g" \
    -e "s/__AUTO_GENERATE_MYSQL_ROOT_PASSWORD__/$mysql_root_password/g" \
    -e "s/__AUTO_GENERATE_REDIS_PASSWORD__/$redis_password/g" \
    -e "s/__AUTO_GENERATE_DB_PASSWORD__/$db_password/g" \
    "$ENV_FILE"

  chmod 600 "$ENV_FILE"

  if [ "$MODE" = "cloud" ]; then
    echo
    echo '已生成 .env，但当前是 cloud 模式。'
    echo '请先编辑 .env，补齐 RDS / Redis / OSS / 域名配置后，再重新执行 ./deploy/release.sh。'
    echo
    exit 0
  fi
}

write_instance_env() {
  if [ "$MODE" = "local" ]; then
    cat >"$INSTANCE_ENV_FILE" <<EOF
DEPLOY_MODE=local
APP_ROLE=export
APP_WORKERS=2
DB_CONNECTION_LIMIT=12
STORAGE_DRIVER=local
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_DOMAIN=
TRUST_PROXY=1
DB_HOST=mysql
DB_PORT=3306
REDIS_URL=
REDIS_HOST=redis
REDIS_PORT=6379
EXPORT_PUBLIC_BASE_URL=
EOF
  else
    if [ "$ROLE" = "app" ]; then
      app_workers=4
      db_connection_limit=8
    else
      app_workers=6
      db_connection_limit=8
    fi

    cat >"$INSTANCE_ENV_FILE" <<EOF
DEPLOY_MODE=cloud
APP_ROLE=$ROLE
APP_WORKERS=$app_workers
DB_CONNECTION_LIMIT=$db_connection_limit
STORAGE_DRIVER=oss
TRUST_PROXY=2
EOF
  fi

  chmod 600 "$INSTANCE_ENV_FILE"
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
    python3
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

mirror = os.getenv("DEFAULT_DOCKER_REGISTRY_MIRROR", "https://docker.m.daocloud.io").strip()
path = Path("/etc/docker/daemon.json")
data = {}
original = path.read_text() if path.exists() else None

if path.exists():
    try:
        data = json.loads(original)
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
updated = json.dumps(data, ensure_ascii=False, indent=2) + "\n"

if original != updated:
    path.write_text(updated)
    print("changed")
else:
    print("unchanged")
PY
}

ensure_docker_stack() {
  mirror_status="$(configure_docker_mirror)"

  if command -v docker >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1 \
    && docker info >/dev/null 2>&1; then
    if [ "$mirror_status" = "changed" ]; then
      systemctl daemon-reload
      systemctl reset-failed docker.service docker.socket || true
      systemctl restart containerd.service
      systemctl restart docker.socket
      systemctl restart docker.service
    fi
    return 0
  fi

  if ! detect_ubuntu; then
    echo '当前机器缺少可用的 Docker / Docker Compose，自动安装仅支持 Ubuntu。'
    exit 1
  fi

  echo '检测到 Docker / Docker Compose 环境未就绪，开始自动安装或修复。'
  install_ubuntu_base_packages
  install_docker_engine

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
}

install_app_firstboot_service() {
  if [ "$MODE" != "cloud" ] || [ "$ROLE" != "app" ]; then
    return 0
  fi

  install -D -m 0755 \
    "$PROJECT_ROOT/deploy/ess-firstboot.sh" \
    /usr/local/bin/youth-contest-ess-firstboot

  install -D -m 0644 \
    "$PROJECT_ROOT/deploy/systemd/youth-contest-ess-firstboot.service" \
    /etc/systemd/system/youth-contest-ess-firstboot.service

  systemctl daemon-reload
  systemctl enable youth-contest-ess-firstboot.service
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

run_db_tasks() {
  if [ "$RUN_DB_INIT" -eq 1 ]; then
    $COMPOSE --profile init run --rm app-init
  fi

  if [ "$RUN_DB_SEED" -eq 1 ]; then
    $COMPOSE run --rm app sh -lc 'npm run db:seed'
  fi
}

reexec_as_root "$@"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --local)
      MODE="local"
      ROLE="export"
      RUN_DB_INIT=1
      RUN_DB_SEED=1
      ;;
    --cloud)
      MODE="cloud"
      ;;
    --role)
      shift
      if [ "$#" -eq 0 ]; then
        echo '缺少 --role 参数值'
        exit 1
      fi
      case "$1" in
        app|export)
          ROLE="$1"
          ;;
        *)
          echo "不支持的角色：$1"
          exit 1
          ;;
      esac
      ;;
    --init-db)
      RUN_DB_INIT=1
      ;;
    --seed-demo)
      RUN_DB_SEED=1
      RUN_DB_INIT=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1"
      usage
      exit 1
      ;;
  esac
  shift
done

if [ "$MODE" = "local" ]; then
  ROLE="export"
fi

bootstrap_env_file
write_instance_env
ensure_docker_stack

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose --env-file $ENV_FILE -f docker-compose.yml"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose --env-file $ENV_FILE -f docker-compose.yml"
else
  echo '未检测到 Docker Compose。'
  exit 1
fi

if [ "$MODE" = "local" ]; then
  COMPOSE="$COMPOSE -f docker-compose.local.yml"
fi

apply_host_sysctl
install_host_nginx

$COMPOSE build app

if [ "$MODE" = "local" ]; then
  $COMPOSE up -d mysql redis
  wait_for_container_health youth-contest-mysql 30 2
  wait_for_container_health youth-contest-redis 30 2
else
  docker rm -f youth-contest-mysql >/dev/null 2>&1 || true
  docker rm -f youth-contest-redis >/dev/null 2>&1 || true
fi

run_db_tasks
$COMPOSE up -d app
$COMPOSE ps
wait_for_container_health youth-contest-app 30 2

echo
echo "当前模式：$MODE"
echo "当前角色：$ROLE"
echo "实例覆盖文件：$INSTANCE_ENV_FILE"
echo '宿主机健康检查：'
wait_for_http http://127.0.0.1:80/healthz 30 2
install_app_firstboot_service
curl --noproxy '*' -fsS http://127.0.0.1:80/healthz
echo
