#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 root 或 sudo 执行此脚本。"
  echo "示例: sudo bash deploy/apply-host-sysctl.sh"
  exit 1
fi

install -D -m 0644 deploy/sysctl/99-youth-contest-ingress.conf /etc/sysctl.d/99-youth-contest-ingress.conf
sysctl --system
