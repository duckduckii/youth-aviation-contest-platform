#!/usr/bin/env sh
set -eu

run_host_script() {
  script_path="$1"

  if [ "$(id -u)" -eq 0 ]; then
    bash "$script_path"
    return 0
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo bash "$script_path"
    return 0
  fi

  echo "需要 root 或 sudo 权限执行宿主机配置：$script_path"
  echo "请使用 root 账号执行 ./deploy/release.sh，或先安装 sudo。"
  exit 1
}

if [ ! -f .env.production ]; then
  echo '.env.production 不存在，请先从 deploy/templates/env.docker.oss.example 或 deploy/templates/env.docker.local.example 复制生成'
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose --env-file .env.production"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose --env-file .env.production"
else
  echo '未检测到 Docker Compose。请安装 Docker Compose 插件，或通过 brew install docker-compose 安装。'
  exit 1
fi

run_host_script ./deploy/apply-host-sysctl.sh
run_host_script ./deploy/install-host-nginx.sh

$COMPOSE build app
$COMPOSE up -d mysql redis
$COMPOSE --profile init run --rm app-init
$COMPOSE up -d app
docker rm -f youth-contest-nginx >/dev/null 2>&1 || true
$COMPOSE ps

echo
echo '宿主机健康检查：'
curl -fsS http://127.0.0.1:3000/healthz
echo
