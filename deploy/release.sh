#!/usr/bin/env sh
set -eu

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

$COMPOSE build app
$COMPOSE up -d mysql redis
$COMPOSE --profile init run --rm app-init
$COMPOSE up -d app
docker rm -f youth-contest-nginx >/dev/null 2>&1 || true
$COMPOSE ps
