#!/usr/bin/env sh
set -eu

if [ ! -f .env.production ]; then
  echo '.env.production 不存在，请先复制 .env.production.example 并填写生产配置'
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
$COMPOSE ps
