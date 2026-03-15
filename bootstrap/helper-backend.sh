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

wait_for_ready() {
  local url="$1"
  for _ in {1..60}; do
    if curl -fsS "$url" | jq -e '.ok == true' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

ENV_FILE="/etc/infrazero/helper-backend.env"
load_env "$ENV_FILE"

require_env "HELPER_BACKEND_BOOTSTRAP_JSON_B64"

HELPER_BACKEND_HOST="${HELPER_BACKEND_FQDN:-}"
if [ -z "$HELPER_BACKEND_HOST" ] && [ -n "${HELPER_BACKEND_PUBLIC_URL:-}" ]; then
  HELPER_BACKEND_HOST="${HELPER_BACKEND_PUBLIC_URL#http://}"
  HELPER_BACKEND_HOST="${HELPER_BACKEND_HOST#https://}"
  HELPER_BACKEND_HOST="${HELPER_BACKEND_HOST%%/*}"
  HELPER_BACKEND_HOST="${HELPER_BACKEND_HOST%%:*}"
fi

require_env "HELPER_BACKEND_HOST"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates jq nginx nodejs npm wireguard-tools

SCRIPT_DIR="/opt/infrazero/bootstrap"
APP_DIR="/opt/infrazero/helper-backend"
STATE_DIR="/var/lib/infrazero-helper"
SERVICE_FILE="/etc/systemd/system/infrazero-helper-backend.service"
NGINX_SITE="/etc/nginx/sites-available/infrazero-helper-backend"
WG_INTERFACE="wg0"
WG_CONFIG_PATH="/etc/wireguard/${WG_INTERFACE}.conf"
SSH_KEY_PATH="${STATE_DIR}/secrets/id_ed25519_helper"
RUNTIME_CONFIG_PATH="${STATE_DIR}/runtime-config.json"

mkdir -p "$APP_DIR" "$STATE_DIR" /etc/wireguard
cp -a "$SCRIPT_DIR/helper-backend-src/." "$APP_DIR/"

tmp_payload=$(mktemp)
echo "$HELPER_BACKEND_BOOTSTRAP_JSON_B64" | base64 -d > "$tmp_payload"
chmod 600 "$tmp_payload"

node - "$tmp_payload" "$RUNTIME_CONFIG_PATH" "$WG_CONFIG_PATH" "$SSH_KEY_PATH" <<'NODE'
const fs = require("fs");
const path = require("path");

const [payloadPath, runtimeConfigPath, wgConfigPath, sshKeyPath] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));

const requireString = (value, name) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`Missing required bootstrap field: ${name}`);
  }
  return normalized;
};

const optionalString = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
};

const ensureNewline = (value) => (value.endsWith("\n") ? value : `${value}\n`);

const networkSource = payload.internal ?? payload.network ?? {};
const wireguard = payload.wireguard ?? null;
const ssh = payload.ssh ?? null;
const github = payload.github ?? null;
const s3 = payload.s3 ?? null;

const runtimeConfig = {
  apiBearerToken: requireString(payload.backendApiToken ?? payload.apiBearerToken, "backendApiToken"),
  network: {
    bastionHost: requireString(networkSource.bastionHost, "internal.bastionHost"),
    egressHost: requireString(networkSource.egressHost, "internal.egressHost"),
    dbHost: requireString(networkSource.dbHost, "internal.dbHost"),
    grafanaUrl: requireString(networkSource.grafanaUrl, "internal.grafanaUrl"),
    lokiUrl: requireString(networkSource.lokiUrl, "internal.lokiUrl"),
    infisicalUrl: requireString(networkSource.infisicalUrl, "internal.infisicalUrl"),
    internalNetworkCidr: requireString(networkSource.internalNetworkCidr, "internal.internalNetworkCidr"),
    wgNetworkCidr: requireString(networkSource.wgNetworkCidr, "internal.wgNetworkCidr"),
  },
};

if (github?.token && github?.owner && github?.infraRepo) {
  runtimeConfig.github = {
    token: requireString(github.token, "github.token"),
    owner: requireString(github.owner, "github.owner"),
    infraRepo: requireString(github.infraRepo, "github.infraRepo"),
    gitopsRepo: optionalString(github.gitopsRepo),
  };
}

if (s3?.endpoint && s3?.region && s3?.accessKeyId && s3?.secretAccessKey && s3?.bucket) {
  runtimeConfig.s3 = {
    endpoint: requireString(s3.endpoint, "s3.endpoint"),
    region: requireString(s3.region, "s3.region"),
    accessKeyId: requireString(s3.accessKeyId, "s3.accessKeyId"),
    secretAccessKey: requireString(s3.secretAccessKey, "s3.secretAccessKey"),
    bucket: requireString(s3.bucket, "s3.bucket"),
  };
}

if (ssh?.privateKey) {
  fs.mkdirSync(path.dirname(sshKeyPath), { recursive: true });
  fs.writeFileSync(sshKeyPath, ensureNewline(String(ssh.privateKey)), {
    encoding: "utf8",
    mode: 0o600,
  });
  runtimeConfig.ssh = {
    user: requireString(ssh.user ?? "admin", "ssh.user"),
    privateKeyPath: sshKeyPath,
    strictHostKeyChecking: optionalString(ssh.strictHostKeyChecking) ?? "accept-new",
  };
}

if (wireguard) {
  const allowedIps = Array.isArray(wireguard.allowedIps)
    ? wireguard.allowedIps.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (!allowedIps.length) {
    throw new Error("WireGuard bootstrap requires allowedIps.");
  }

  runtimeConfig.wireguard = {
    address: requireString(wireguard.address, "wireguard.address"),
    privateKey: requireString(wireguard.privateKey, "wireguard.privateKey"),
    serverPublicKey: requireString(wireguard.serverPublicKey, "wireguard.serverPublicKey"),
    presharedKey: optionalString(wireguard.presharedKey),
    endpoint: requireString(wireguard.endpoint, "wireguard.endpoint"),
    allowedIps,
    dns: Array.isArray(wireguard.dns)
      ? wireguard.dns.map((value) => String(value).trim()).filter(Boolean)
      : undefined,
    persistentKeepalive:
      typeof wireguard.persistentKeepalive === "number" && wireguard.persistentKeepalive > 0
        ? wireguard.persistentKeepalive
        : undefined,
  };

  const lines = [
    "[Interface]",
    `PrivateKey = ${runtimeConfig.wireguard.privateKey}`,
    `Address = ${runtimeConfig.wireguard.address}`,
  ];

  if (runtimeConfig.wireguard.dns?.length) {
    lines.push(`DNS = ${runtimeConfig.wireguard.dns.join(", ")}`);
  }

  lines.push("", "[Peer]", `PublicKey = ${runtimeConfig.wireguard.serverPublicKey}`);
  if (runtimeConfig.wireguard.presharedKey) {
    lines.push(`PresharedKey = ${runtimeConfig.wireguard.presharedKey}`);
  }
  lines.push(
    `Endpoint = ${runtimeConfig.wireguard.endpoint}`,
    `AllowedIPs = ${runtimeConfig.wireguard.allowedIps.join(", ")}`,
    `PersistentKeepalive = ${runtimeConfig.wireguard.persistentKeepalive ?? 25}`
  );

  fs.mkdirSync(path.dirname(wgConfigPath), { recursive: true });
  fs.writeFileSync(wgConfigPath, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
fs.writeFileSync(runtimeConfigPath, JSON.stringify(runtimeConfig, null, 2), {
  encoding: "utf8",
  mode: 0o600,
});
NODE

rm -f "$tmp_payload"

if [ -f "$WG_CONFIG_PATH" ]; then
  chmod 600 "$WG_CONFIG_PATH"
  systemctl daemon-reload
  systemctl enable --now "wg-quick@${WG_INTERFACE}"
  echo "[helper-backend] wg diagnostics"
  wg show "$WG_INTERFACE" || true
  ip a show "$WG_INTERFACE" || true
  ip route || true
  systemctl status "wg-quick@${WG_INTERFACE}" --no-pager || true
fi

cat > "$NGINX_SITE" <<EOF
server {
  listen 80;
  server_name ${HELPER_BACKEND_HOST};

  location / {
    proxy_http_version 1.1;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600;
  }
}
EOF

ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/infrazero-helper-backend
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl restart nginx

cd "$APP_DIR"
npm ci
npm run build

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=InfraZero Helper Backend
After=network-online.target wg-quick@${WG_INTERFACE}.service
Wants=network-online.target wg-quick@${WG_INTERFACE}.service

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=INFRAZERO_HELPER_STATE_DIR=${STATE_DIR}
Environment=INFRAZERO_HELPER_WG_INTERFACE_NAME=${WG_INTERFACE}
Environment=INFRAZERO_HELPER_WG_CONFIG_PATH=${WG_CONFIG_PATH}
Environment=INFRAZERO_HELPER_SSH_KEY_PATH=${SSH_KEY_PATH}
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

if ! wait_for_ready "http://127.0.0.1:3000/api/v1/ready"; then
  echo "[helper-backend] backend service did not become ready" >&2
  curl -fsS "http://127.0.0.1:3000/api/v1/wireguard/status" || true
  journalctl -u "wg-quick@${WG_INTERFACE}" -n 200 --no-pager || true
  journalctl -u infrazero-helper-backend.service -n 200 --no-pager || true
  exit 1
fi

curl -fsS "http://127.0.0.1:3000/api/v1/ready" | jq .
echo "[helper-backend] bootstrap complete"
