#!/usr/bin/env bash
set -euo pipefail

install -D -m 0644 deploy/sysctl/99-youth-contest-ingress.conf /etc/sysctl.d/99-youth-contest-ingress.conf
sysctl --system
