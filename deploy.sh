#!/bin/bash
# Build and (re)start the production stack on this machine, then remove
# everything the build left behind: BuildKit cache, dangling images and the
# builder-only base images. Only the running images (web + mariadb) stay.
#
#   ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

# --pull: pick up base-image security fixes on every deploy
docker compose build --pull web
docker compose up -d --remove-orphans

docker image prune -f
docker builder prune -af
# Builder stages only; re-pulled (~50 MB) by the next build
docker image rm node:24-alpine3.23 2>/dev/null || true

# Colima: hand the freed blocks back to macOS now instead of at the next VM boot
if command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
  colima ssh -- sudo fstrim -a >/dev/null || true
fi

docker compose ps
docker system df
