#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 root 或 sudo 执行此脚本。"
  echo "示例: sudo bash deploy/install-docker-ubuntu.sh"
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then
  echo "无法识别当前系统，缺少 /etc/os-release"
  exit 1
fi

. /etc/os-release

if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "当前系统不是 Ubuntu，检测到: ${PRETTY_NAME:-unknown}"
  echo "这个脚本只针对 Ubuntu 22.04/24.04。"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

export DEFAULT_DOCKER_REGISTRY_MIRROR="${DOCKER_REGISTRY_MIRROR:-https://docker.m.daocloud.io}"

install_docker_engine() {
  echo "[2/5] 安装 Docker Engine"
  if curl -fsSL https://get.docker.com | sh; then
    return 0
  fi

  echo "官方安装脚本执行失败，回退到 Ubuntu 仓库安装 docker.io"
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
  echo "[3/5] 配置 Docker 镜像加速"
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

echo "[1/5] 安装基础依赖"
apt-get update
apt-get install -y \
  ca-certificates \
  curl \
  git \
  uidmap \
  iptables \
  apt-transport-https \
  gnupg \
  lsb-release

install_docker_engine

configure_docker_mirror

echo "[4/5] 启用并启动 Docker"
systemctl enable docker
systemctl restart docker

echo "[5/5] 检查 Docker Compose"
if ! docker compose version >/dev/null 2>&1; then
  apt-get update
  apt-get install -y docker-compose-v2 || apt-get install -y docker-compose-plugin
fi

TARGET_USER="${SUDO_USER:-root}"
if id "${TARGET_USER}" >/dev/null 2>&1; then
  echo "将用户 ${TARGET_USER} 加入 docker 用户组"
  usermod -aG docker "${TARGET_USER}" || true
fi

echo
echo "安装完成，版本信息如下:"
docker --version
docker compose version

echo
echo "后续操作:"
echo "1. 如果你是通过 sudo 执行的，请退出当前 SSH 后重新登录，使 docker 用户组生效。"
echo "2. 当前默认 Docker 镜像加速地址: ${DEFAULT_DOCKER_REGISTRY_MIRROR}"
echo "3. 回到项目目录执行:"
echo "   cd /home/youth-aviation-contest-platform"
echo "   chmod +x deploy/release.sh"
echo "   ./deploy/release.sh"
echo "   release.sh 会自动应用宿主机 sysctl、安装/更新宿主机 nginx，并拉起 mysql/redis/app 容器"
