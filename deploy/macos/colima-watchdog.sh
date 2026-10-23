#!/bin/bash
# Boot + watchdog for the Colima VM that runs the stack (macOS, non-admin user).
# Run by com.concert-tracker.colima (LaunchDaemon, UserName=<this user>) at boot
# and every 5 minutes. Idempotent: a healthy VM is left alone.
#
#   healthy        → nothing (containers restart themselves: restart: unless-stopped)
#   VM down        → colima start (reuses the saved profile: CPUs/RAM/disk/mounts)
#   VM up, docker  → colima stop --force + start. lima 2.1.3 leaves a VM "Broken"
#   unreachable      after an unclean stop, and the forwarded docker.sock is known
#                    to die silently after days of uptime
set -u
export HOME="${HOME:-$(eval echo ~"$(id -un)")}"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
STACK_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$HOME/Library/Logs/concert-tracker-watchdog.log"
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1

log() { echo "$(date '+%F %T') $*"; }

# Keep the log small: last 500 lines
if [ "$(wc -l <"$LOG")" -gt 1000 ]; then
  tail -n 500 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

docker_ok() { docker info >/dev/null 2>&1; }

# Maintenance: `touch ~/.concert-tracker-pause` to stop the watchdog acting
[ -e "$HOME/.concert-tracker-pause" ] && exit 0

if colima status >/dev/null 2>&1; then
  docker_ok && exit 0
  log "VM up but docker unreachable — restarting colima"
  colima stop --force
else
  log "VM not running — starting"
  colima stop --force >/dev/null 2>&1 || true
fi

if ! colima start; then
  log "colima start failed"
  exit 1
fi

for _ in $(seq 1 30); do docker_ok && break; sleep 2; done
docker_ok || { log "docker still unreachable after start"; exit 1; }

# Containers come back on their own; this only covers a stack that was never up
cd "$STACK_DIR" && docker compose up -d && log "stack up"
