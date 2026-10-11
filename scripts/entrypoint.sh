#!/usr/bin/env bash
# Start the wrapper as the unprivileged "openclaw" user.
#
# Railway mounts the /data volume owned by root, and existing deployments created files
# there as root. While still root, hand ownership of /data to the openclaw user (only the
# entries that need it), then drop privileges for good. If the container is already
# started as a non-root user, just run the command.
set -euo pipefail

RUN_USER="openclaw"
DATA_DIR="${OPENCLAW_DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  find "$DATA_DIR" -xdev \( ! -user "$RUN_USER" -o ! -group "$RUN_USER" \) \
    -exec chown -h "$RUN_USER:$RUN_USER" {} + 2>/dev/null || true
  # Secrets and config should not be world-readable.
  if [ -d "$DATA_DIR/.openclaw" ]; then
    chmod 0700 "$DATA_DIR/.openclaw" || true
  fi
  export HOME="/home/$RUN_USER"
  export USER="$RUN_USER"
  exec setpriv --reuid="$RUN_USER" --regid="$RUN_USER" --init-groups --inh-caps=-all --bounding-set=-all --no-new-privs -- "$@"
fi

exec "$@"
