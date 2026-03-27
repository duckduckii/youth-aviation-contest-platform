#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 root 或 sudo 执行此脚本。"
  echo "示例: sudo bash deploy/install-host-nginx.sh"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  apt-get update
  apt-get install -y nginx
fi

install -D -m 0644 deploy/nginx/host-nginx.conf /etc/nginx/nginx.conf

nginx -t
systemctl enable nginx
systemctl restart nginx
systemctl status nginx --no-pager
