#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="/var/log/infrazero-bootstrap.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[helper-backend] $(date -Is) start"

load_env() {
  local file="$1"
  if [ -f "$file" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
  fi
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "[helper-backend] missing required env: $name" >&2
    exit 1
  fi
}

wait_for_http() {
  local url="$1"
  for _ in {1..60}; do
    local code=""
    code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$url" || true)
    if [ "$code" = "200" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

ENV_FILE="/etc/infrazero/helper-backend.env"
load_env "$ENV_FILE"

require_env "HELPER_BACKEND_BOOTSTRAP_JSON_B64"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates jq nodejs npm wireguard-tools

SCRIPT_DIR="/opt/infrazero/bootstrap"
APP_DIR="/opt/infrazero/helper-backend"
STATE_DIR="/var/lib/infrazero-helper"
SERVICE_FILE="/etc/systemd/system/infrazero-helper-backend.service"

mkdir -p "$APP_DIR" "$STATE_DIR"
cp -a "$SCRIPT_DIR/helper-backend-src/." "$APP_DIR/"

cd "$APP_DIR"
npm ci
npm run build

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=InfraZero Helper Backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=INFRAZERO_HELPER_STATE_DIR=${STATE_DIR}
Environment=INFRAZERO_HELPER_WG_CONFIG_NAME=infrazero-helper
Environment=INFRAZERO_HELPER_WG_CONFIG_PATH=${STATE_DIR}/wireguard/infrazero-helper.conf
Environment=INFRAZERO_HELPER_SSH_KEY_PATH=${STATE_DIR}/secrets/id_ed25519_helper
ExecStart=/usr/bin/node ${APP_DIR}/dist/index.js
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now infrazero-helper-backend.service

if ! wait_for_http "http://127.0.0.1:3000/api/v1/health"; then
  echo "[helper-backend] backend service did not become healthy" >&2
  journalctl -u infrazero-helper-backend.service -n 200 --no-pager || true
  exit 1
fi

bootstrap_status=$(curl -fsS "http://127.0.0.1:3000/api/v1/bootstrap/status" || true)
if echo "$bootstrap_status" | jq -e '.configured == true' >/dev/null 2>&1; then
  echo "[helper-backend] runtime already configured"
  exit 0
fi

tmp_payload=$(mktemp)
echo "$HELPER_BACKEND_BOOTSTRAP_JSON_B64" | base64 -d > "$tmp_payload"
chmod 600 "$tmp_payload"

curl -fsS \
  -H "Content-Type: application/json" \
  -X POST \
  --data @"$tmp_payload" \
  "http://127.0.0.1:3000/api/v1/bootstrap/configure" >/dev/null

rm -f "$tmp_payload"

curl -fsS "http://127.0.0.1:3000/api/v1/bootstrap/status" | jq .
echo "[helper-backend] bootstrap complete"
