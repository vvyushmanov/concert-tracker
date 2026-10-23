#!/bin/bash
# Build and (re)start the production stack on this machine, then remove
# everything the build left behind: BuildKit cache, dangling images and the
# builder-only base images. Only the running images (web + mariadb) stay.
#
#   ./deploy.sh
#   BUILD_MEMORY=2 ./deploy.sh   # Colima only: build with 2 GiB, then back
#
# A full build fits in a 1 GiB Colima VM (measured), so BUILD_MEMORY is only a
# fallback if dependencies ever outgrow it. It restarts the VM twice (the stack
# is down meanwhile), because a VM never hands touched memory back to macOS —
# only a restart at the smaller size does.
set -euo pipefail
cd "$(dirname "$0")"

colima_memory() { awk '/^memory:/ {print $2}' "$HOME/.colima/default/colima.yaml"; }
colima_resize() {
  colima stop
  colima start --memory "$1"
}

if [ -n "${BUILD_MEMORY:-}" ] && command -v colima >/dev/null 2>&1; then
  RUN_MEMORY=$(colima_memory)
  # Keep the boot watchdog (deploy/macos) from restarting the VM under us
  PAUSE="$HOME/.concert-tracker-pause"
  touch "$PAUSE"
  trap 'colima_resize "$RUN_MEMORY"; rm -f "$PAUSE"' EXIT
  colima_resize "$BUILD_MEMORY"
fi

# --pull: pick up base-image security fixes on every deploy
if ! docker compose build --pull web; then
  echo "Build failed. If it was killed for memory (exit 137), retry with: BUILD_MEMORY=2 ./deploy.sh" >&2
  exit 1
fi
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
