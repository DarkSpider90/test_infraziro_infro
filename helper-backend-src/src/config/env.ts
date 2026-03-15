import os from "node:os";
import path from "node:path";

export type AppEnv = {
  NODE_ENV: string;
  PORT: number;
  API_BEARER_TOKEN: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_INFRA_REPO: string;
  GITHUB_GITOPS_REPO: string;
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  DB_BACKUP_BUCKET: string;
  SSH_USER: string;
  SSH_PRIVATE_KEY_PATH: string;
  SSH_STRICT_HOST_KEY_CHECKING: string;
  BASTION_HOST: string;
  EGRESS_HOST: string;
  DB_HOST: string;
  GRAFANA_URL: string;
  LOKI_URL: string;
  INFISICAL_URL: string;
  INTERNAL_NETWORK_CIDR: string;
  WG_NETWORK_CIDR: string;
  STATE_DIR: string;
  WG_CONFIG_NAME: string;
  WG_CONFIG_PATH: string;
  SSH_STATE_PRIVATE_KEY_PATH: string;
};

const envWarnings: string[] = [];

const readString = (name: string, fallback = ""): string => {
  const raw = process.env[name];
  const value = String(raw ?? fallback).trim();
  if (!String(raw ?? "").trim() && fallback) {
    envWarnings.push(`Using fallback for ${name}: ${fallback}`);
  }
  return value;
};

const readPort = (name: string, fallback: number): number => {
  const raw = readString(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`Invalid port env ${name}: ${raw}`);
  }
  return value;
};

export const hasExplicitEnv = (name: string) => Boolean(String(process.env[name] ?? "").trim());

const defaultStateDir = path.join(os.homedir(), ".infrazero-helper");
const defaultWgConfigName = "infrazero-helper";

export const env: AppEnv = {
  NODE_ENV: readString("NODE_ENV", "production"),
  PORT: readPort("PORT", 3000),
  API_BEARER_TOKEN: readString("API_BEARER_TOKEN", "infrazero-helper-dev-token"),
  GITHUB_TOKEN: readString("GITHUB_TOKEN"),
  GITHUB_OWNER: readString("GITHUB_OWNER"),
  GITHUB_INFRA_REPO: readString("GITHUB_INFRA_REPO"),
  GITHUB_GITOPS_REPO: readString("GITHUB_GITOPS_REPO"),
  S3_ENDPOINT: readString("S3_ENDPOINT"),
  S3_REGION: readString("S3_REGION"),
  S3_ACCESS_KEY_ID: readString("S3_ACCESS_KEY_ID"),
  S3_SECRET_ACCESS_KEY: readString("S3_SECRET_ACCESS_KEY"),
  DB_BACKUP_BUCKET: readString("DB_BACKUP_BUCKET"),
  SSH_USER: readString("SSH_USER", "admin"),
  SSH_PRIVATE_KEY_PATH: readString("SSH_PRIVATE_KEY_PATH", "/run/secrets/id_ed25519_admin"),
  SSH_STRICT_HOST_KEY_CHECKING: readString("SSH_STRICT_HOST_KEY_CHECKING", "accept-new"),
  BASTION_HOST: readString("BASTION_HOST", "10.10.0.10"),
  EGRESS_HOST: readString("EGRESS_HOST", "10.10.0.11"),
  DB_HOST: readString("DB_HOST", "10.10.0.30"),
  GRAFANA_URL: readString("GRAFANA_URL", "http://10.10.0.11:3000"),
  LOKI_URL: readString("LOKI_URL", "http://10.10.0.11:3100"),
  INFISICAL_URL: readString("INFISICAL_URL", "http://10.10.0.11:8080"),
  INTERNAL_NETWORK_CIDR: readString("INTERNAL_NETWORK_CIDR", "10.10.0.0/24"),
  WG_NETWORK_CIDR: readString("WG_NETWORK_CIDR", "10.50.0.0/24"),
  STATE_DIR: readString("INFRAZERO_HELPER_STATE_DIR", defaultStateDir),
  WG_CONFIG_NAME: readString("INFRAZERO_HELPER_WG_CONFIG_NAME", defaultWgConfigName),
  WG_CONFIG_PATH: readString(
    "INFRAZERO_HELPER_WG_CONFIG_PATH",
    path.join(defaultStateDir, "wireguard", `${defaultWgConfigName}.conf`)
  ),
  SSH_STATE_PRIVATE_KEY_PATH: readString(
    "INFRAZERO_HELPER_SSH_KEY_PATH",
    path.join(defaultStateDir, "secrets", "id_ed25519_helper")
  ),
};

export const getEnvWarnings = () => [...new Set(envWarnings)];
