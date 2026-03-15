import fs from "node:fs/promises";
import path from "node:path";
import { env, hasExplicitEnv } from "./env.js";
import {
  configureSystemWireGuard,
  ensureConnected,
  getWireGuardStatus,
  refreshWireGuardStatus,
  type RuntimeWireGuardConfig,
} from "../services/wireguard.js";

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type RuntimeGithubConfig = {
  token: string;
  owner: string;
  infraRepo: string;
  gitopsRepo?: string;
};

export type RuntimeS3Config = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export type RuntimeSshConfig = {
  user: string;
  privateKeyPath: string;
  strictHostKeyChecking: string;
};

export type RuntimeNetworkConfig = {
  bastionHost: string;
  egressHost: string;
  dbHost: string;
  grafanaUrl: string;
  lokiUrl: string;
  infisicalUrl: string;
  internalNetworkCidr: string;
  wgNetworkCidr: string;
};

export type RuntimeProjectConfig = {
  apiBearerToken: string;
  network: RuntimeNetworkConfig;
  github?: RuntimeGithubConfig;
  s3?: RuntimeS3Config;
  ssh?: RuntimeSshConfig;
  wireguard?: RuntimeWireGuardConfig;
};

export type BootstrapPayload = {
  backendApiToken?: string;
  apiBearerToken?: string;
  wireguard?: Partial<RuntimeWireGuardConfig>;
  internal?: Partial<RuntimeNetworkConfig>;
  network?: Partial<RuntimeNetworkConfig>;
  github?: Partial<RuntimeGithubConfig>;
  s3?: Partial<RuntimeS3Config>;
  ssh?: {
    user?: string;
    privateKey?: string;
    privateKeyPath?: string;
    strictHostKeyChecking?: string;
  };
};

export type RuntimeSource = "env" | "persisted" | "waiting";
export type RuntimeMode = "configured" | "waiting_for_bootstrap";

type RuntimeState = {
  mode: RuntimeMode;
  source: RuntimeSource;
  config: RuntimeProjectConfig | null;
  updatedAt?: string;
};

const runtimeConfigPath = path.join(env.STATE_DIR, "runtime-config.json");
const requiredEnvVars = [
  "API_BEARER_TOKEN",
  "BASTION_HOST",
  "EGRESS_HOST",
  "DB_HOST",
  "GRAFANA_URL",
  "LOKI_URL",
  "INFISICAL_URL",
];

let runtimeState: RuntimeState = {
  mode: "waiting_for_bootstrap",
  source: "waiting",
  config: null,
};

const getLogger = (logger?: Partial<LoggerLike>): LoggerLike => ({
  info: (message: string) => logger?.info?.(message) ?? console.log(message),
  warn: (message: string) => logger?.warn?.(message) ?? console.warn(message),
  error: (message: string) => logger?.error?.(message) ?? console.error(message),
});

const withTimestamp = <T extends object>(value: T): T & { updatedAt: string } => ({
  ...value,
  updatedAt: new Date().toISOString(),
});

const hasRequiredExplicitEnv = () => requiredEnvVars.every(hasExplicitEnv);

const buildConfigFromEnv = (): RuntimeProjectConfig => {
  const config: RuntimeProjectConfig = {
    apiBearerToken: env.API_BEARER_TOKEN,
    network: {
      bastionHost: env.BASTION_HOST,
      egressHost: env.EGRESS_HOST,
      dbHost: env.DB_HOST,
      grafanaUrl: env.GRAFANA_URL,
      lokiUrl: env.LOKI_URL,
      infisicalUrl: env.INFISICAL_URL,
      internalNetworkCidr: env.INTERNAL_NETWORK_CIDR,
      wgNetworkCidr: env.WG_NETWORK_CIDR,
    },
  };

  if (env.GITHUB_TOKEN && env.GITHUB_OWNER && env.GITHUB_INFRA_REPO) {
    config.github = {
      token: env.GITHUB_TOKEN,
      owner: env.GITHUB_OWNER,
      infraRepo: env.GITHUB_INFRA_REPO,
      gitopsRepo: env.GITHUB_GITOPS_REPO || undefined,
    };
  }

  if (env.S3_ENDPOINT && env.S3_REGION && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.DB_BACKUP_BUCKET) {
    config.s3 = {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      bucket: env.DB_BACKUP_BUCKET,
    };
  }

  if (env.SSH_USER && env.SSH_PRIVATE_KEY_PATH) {
    config.ssh = {
      user: env.SSH_USER,
      privateKeyPath: env.SSH_PRIVATE_KEY_PATH,
      strictHostKeyChecking: env.SSH_STRICT_HOST_KEY_CHECKING,
    };
  }

  return config;
};

const cloneConfig = (config: RuntimeProjectConfig) => JSON.parse(JSON.stringify(config)) as RuntimeProjectConfig;

const setRuntimeState = (next: RuntimeState) => {
  runtimeState = withTimestamp(next);
};

const throwStatus = (message: string, statusCode = 503): never => {
  throw Object.assign(new Error(message), { statusCode });
};

const normalizeNetwork = (payload: BootstrapPayload): RuntimeNetworkConfig => {
  const source = payload.internal ?? payload.network ?? {};

  return {
    bastionHost: String(source.bastionHost ?? env.BASTION_HOST).trim(),
    egressHost: String(source.egressHost ?? env.EGRESS_HOST).trim(),
    dbHost: String(source.dbHost ?? env.DB_HOST).trim(),
    grafanaUrl: String(source.grafanaUrl ?? env.GRAFANA_URL).trim(),
    lokiUrl: String(source.lokiUrl ?? env.LOKI_URL).trim(),
    infisicalUrl: String(source.infisicalUrl ?? env.INFISICAL_URL).trim(),
    internalNetworkCidr: String(source.internalNetworkCidr ?? env.INTERNAL_NETWORK_CIDR).trim(),
    wgNetworkCidr: String(source.wgNetworkCidr ?? env.WG_NETWORK_CIDR).trim(),
  };
};

const normalizeWireGuard = (payload: BootstrapPayload, network: RuntimeNetworkConfig): RuntimeWireGuardConfig | undefined => {
  const wg = payload.wireguard;
  if (!wg) {
    return undefined;
  }

  const address = String(wg.address ?? "").trim();
  const privateKey = String(wg.privateKey ?? "").trim();
  const serverPublicKey = String(wg.serverPublicKey ?? "").trim();
  const endpoint = String(wg.endpoint ?? "").trim();
  const allowedIps =
    Array.isArray(wg.allowedIps) && wg.allowedIps.length
      ? wg.allowedIps.map((value) => String(value).trim()).filter(Boolean)
      : [network.wgNetworkCidr, network.internalNetworkCidr];

  if (!address || !privateKey || !serverPublicKey || !endpoint || !allowedIps.length) {
    throwStatus("Bootstrap payload is missing required WireGuard fields.", 400);
  }

  return {
    address,
    privateKey,
    serverPublicKey,
    endpoint,
    allowedIps,
    presharedKey: String(wg.presharedKey ?? "").trim() || undefined,
    dns: Array.isArray(wg.dns) ? wg.dns.map((value) => String(value).trim()).filter(Boolean) : undefined,
    persistentKeepalive:
      typeof wg.persistentKeepalive === "number" && wg.persistentKeepalive > 0
        ? wg.persistentKeepalive
        : undefined,
  };
};

const normalizeGithub = (payload: BootstrapPayload): RuntimeGithubConfig | undefined => {
  if (!payload.github) {
    return undefined;
  }

  const token = String(payload.github.token ?? "").trim();
  const owner = String(payload.github.owner ?? "").trim();
  const infraRepo = String(payload.github.infraRepo ?? "").trim();
  if (!token || !owner || !infraRepo) {
    return undefined;
  }

  return {
    token,
    owner,
    infraRepo,
    gitopsRepo: String(payload.github.gitopsRepo ?? "").trim() || undefined,
  };
};

const normalizeS3 = (payload: BootstrapPayload): RuntimeS3Config | undefined => {
  if (!payload.s3) {
    return undefined;
  }

  const endpoint = String(payload.s3.endpoint ?? "").trim();
  const region = String(payload.s3.region ?? "").trim();
  const accessKeyId = String(payload.s3.accessKeyId ?? "").trim();
  const secretAccessKey = String(payload.s3.secretAccessKey ?? "").trim();
  const bucket = String(payload.s3.bucket ?? "").trim();

  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) {
    return undefined;
  }

  return {
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucket,
  };
};

const persistSshPrivateKey = async (privateKey: string) => {
  await fs.mkdir(path.dirname(env.SSH_STATE_PRIVATE_KEY_PATH), { recursive: true });
  await fs.writeFile(env.SSH_STATE_PRIVATE_KEY_PATH, privateKey.endsWith("\n") ? privateKey : `${privateKey}\n`, "utf8");
  return env.SSH_STATE_PRIVATE_KEY_PATH;
};

const normalizeSsh = async (payload: BootstrapPayload): Promise<RuntimeSshConfig | undefined> => {
  if (!payload.ssh) {
    return undefined;
  }

  const user = String(payload.ssh.user ?? env.SSH_USER).trim();
  const strictHostKeyChecking = String(
    payload.ssh.strictHostKeyChecking ?? env.SSH_STRICT_HOST_KEY_CHECKING
  ).trim();

  let privateKeyPath = String(payload.ssh.privateKeyPath ?? "").trim();
  const privateKey = String(payload.ssh.privateKey ?? "").trim();

  if (privateKey) {
    privateKeyPath = await persistSshPrivateKey(privateKey);
  }

  if (!user || !privateKeyPath) {
    return undefined;
  }

  return {
    user,
    privateKeyPath,
    strictHostKeyChecking,
  };
};

const normalizeBootstrapPayload = async (payload: BootstrapPayload): Promise<RuntimeProjectConfig> => {
  const apiBearerToken = String(payload.backendApiToken ?? payload.apiBearerToken ?? "").trim();
  if (!apiBearerToken) {
    throwStatus("Bootstrap payload is missing backendApiToken.", 400);
  }

  const network = normalizeNetwork(payload);
  const wireguard = normalizeWireGuard(payload, network);
  const ssh = await normalizeSsh(payload);

  return {
    apiBearerToken,
    network,
    wireguard,
    github: normalizeGithub(payload),
    s3: normalizeS3(payload),
    ssh,
  };
};

const writeRuntimeConfig = async (config: RuntimeProjectConfig) => {
  await fs.mkdir(path.dirname(runtimeConfigPath), { recursive: true });
  await fs.writeFile(runtimeConfigPath, JSON.stringify(config, null, 2), "utf8");
};

const readPersistedRuntimeConfig = async (): Promise<RuntimeProjectConfig | null> => {
  try {
    const raw = await fs.readFile(runtimeConfigPath, "utf8");
    const parsed = JSON.parse(raw) as RuntimeProjectConfig;
    return parsed?.apiBearerToken && parsed?.network ? parsed : null;
  } catch {
    return null;
  }
};

export const initializeRuntimeConfig = async (logger?: Partial<LoggerLike>) => {
  const log = getLogger(logger);
  await fs.mkdir(env.STATE_DIR, { recursive: true });

  if (hasRequiredExplicitEnv()) {
    const config = buildConfigFromEnv();
    setRuntimeState({
      mode: "configured",
      source: "env",
      config,
    });
    await refreshWireGuardStatus();
    return runtimeState;
  }

  const persisted = await readPersistedRuntimeConfig();
  if (persisted) {
    setRuntimeState({
      mode: "configured",
      source: "persisted",
      config: persisted,
    });
    if (persisted.wireguard) {
      await ensureConnected(log);
    } else {
      await refreshWireGuardStatus();
    }
    return runtimeState;
  }

  setRuntimeState({
    mode: "waiting_for_bootstrap",
    source: "waiting",
    config: null,
  });
  await refreshWireGuardStatus();
  return runtimeState;
};

export const configureRuntime = async (payload: BootstrapPayload, logger?: Partial<LoggerLike>) => {
  const log = getLogger(logger);
  const config = await normalizeBootstrapPayload(payload);
  await writeRuntimeConfig(config);
  setRuntimeState({
    mode: "configured",
    source: "persisted",
    config,
  });

  if (config.wireguard) {
    await configureSystemWireGuard(config.wireguard, log);
  } else {
    await refreshWireGuardStatus();
  }

  return cloneConfig(config);
};

export const getRuntimeState = () => ({
  ...runtimeState,
  config: runtimeState.config ? cloneConfig(runtimeState.config) : null,
  wireguard: getWireGuardStatus(),
});

export const isRuntimeConfigured = () => runtimeState.mode === "configured" && Boolean(runtimeState.config);

export const getRuntimeConfig = () => (runtimeState.config ? cloneConfig(runtimeState.config) : null);

export const getAuthToken = () => runtimeState.config?.apiBearerToken ?? env.API_BEARER_TOKEN;

export const requireRuntimeConfig = (feature = "This endpoint"): RuntimeProjectConfig => {
  const config = runtimeState.config;
  if (!config) {
    throwStatus(`${feature} is unavailable while the helper backend is waiting for bootstrap configuration.`, 503);
  }
  return cloneConfig(config as RuntimeProjectConfig);
};

export const requireGithubConfig = (): RuntimeGithubConfig => {
  const config = requireRuntimeConfig("GitHub workflow access");
  const github = config.github;
  if (!github) {
    throwStatus("GitHub workflow access is not configured for the helper backend.", 503);
  }
  return github as RuntimeGithubConfig;
};

export const requireS3Config = (): RuntimeS3Config => {
  const config = requireRuntimeConfig("S3 backup upload");
  const s3 = config.s3;
  if (!s3) {
    throwStatus("S3 backup upload is not configured for the helper backend.", 503);
  }
  return s3 as RuntimeS3Config;
};

export const requireSshConfig = (): RuntimeSshConfig => {
  const config = requireRuntimeConfig("SSH operations");
  const ssh = config.ssh;
  if (!ssh) {
    throwStatus("SSH operations are not configured for the helper backend.", 503);
  }
  return ssh as RuntimeSshConfig;
};

export const getServiceTargets = () => {
  const config = getRuntimeConfig();
  return {
    bastion: config?.network.bastionHost ?? env.BASTION_HOST,
    egress: config?.network.egressHost ?? env.EGRESS_HOST,
    db: config?.network.dbHost ?? env.DB_HOST,
  } as const;
};

export type ServiceTarget = keyof ReturnType<typeof getServiceTargets>;

export const getInternalServices = () => {
  const config = getRuntimeConfig();
  const grafanaUrl = config?.network.grafanaUrl ?? env.GRAFANA_URL;
  const lokiUrl = config?.network.lokiUrl ?? env.LOKI_URL;
  const infisicalUrl = config?.network.infisicalUrl ?? env.INFISICAL_URL;

  return {
    grafana: `${grafanaUrl.replace(/\/+$/, "")}/api/health`,
    loki: `${lokiUrl.replace(/\/+$/, "")}/ready`,
    infisical: `${infisicalUrl.replace(/\/+$/, "")}/api/status`,
  } as const;
};

export const getRuntimeNetwork = () => {
  const config = getRuntimeConfig();
  return config?.network ?? {
    bastionHost: env.BASTION_HOST,
    egressHost: env.EGRESS_HOST,
    dbHost: env.DB_HOST,
    grafanaUrl: env.GRAFANA_URL,
    lokiUrl: env.LOKI_URL,
    infisicalUrl: env.INFISICAL_URL,
    internalNetworkCidr: env.INTERNAL_NETWORK_CIDR,
    wgNetworkCidr: env.WG_NETWORK_CIDR,
  };
};
