#!/usr/bin/env bash
set -euo pipefail

if ! command -v nginx >/dev/null 2>&1; then
  apt-get update
  apt-get install -y nginx
fi

install -D -m 0644 deploy/nginx/host-nginx.conf /etc/nginx/nginx.conf

nginx -t
systemctl enable nginx
systemctl restart nginx
systemctl status nginx --no-pager
