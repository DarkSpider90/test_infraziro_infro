import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { runCommand } from "../utils/shell.js";

export type RuntimeWireGuardConfig = {
  address: string;
  privateKey: string;
  serverPublicKey: string;
  presharedKey?: string;
  endpoint: string;
  allowedIps: string[];
  dns?: string[];
  persistentKeepalive?: number;
};

export type WireGuardState =
  | "not_configured"
  | "pending"
  | "up"
  | "manual_required"
  | "error";

export type WireGuardPeerStatus = {
  publicKey: string;
  endpoint?: string;
  allowedIps: string[];
  latestHandshakeAt?: string;
  latestHandshakeAgeSeconds?: number;
};

export type WireGuardStatus = {
  state: WireGuardState;
  interfaceName: string;
  interfaceUp: boolean;
  configPath: string;
  serviceActive?: string;
  peers: WireGuardPeerStatus[];
  message?: string;
  updatedAt?: string;
};

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

let wireGuardStatus: WireGuardStatus = {
  state: "not_configured",
  interfaceName: env.WG_INTERFACE_NAME,
  interfaceUp: false,
  configPath: env.WG_CONFIG_PATH,
  peers: [],
};
let wireGuardMutation = Promise.resolve();

const getLogger = (logger?: Partial<LoggerLike>): LoggerLike => ({
  info: (message: string) => logger?.info?.(message) ?? console.log(message),
  warn: (message: string) => logger?.warn?.(message) ?? console.warn(message),
  error: (message: string) => logger?.error?.(message) ?? console.error(message),
});

const setStatus = (status: Partial<WireGuardStatus>) => {
  wireGuardStatus = {
    ...wireGuardStatus,
    ...status,
    interfaceName: env.WG_INTERFACE_NAME,
    configPath: env.WG_CONFIG_PATH,
    updatedAt: new Date().toISOString(),
  };
};

const buildConfigText = (config: RuntimeWireGuardConfig) => {
  const lines = [
    "[Interface]",
    `PrivateKey = ${config.privateKey}`,
    `Address = ${config.address}`,
  ];

  if (config.dns?.length) {
    lines.push(`DNS = ${config.dns.join(", ")}`);
  }

  lines.push("", "[Peer]", `PublicKey = ${config.serverPublicKey}`);

  if (config.presharedKey) {
    lines.push(`PresharedKey = ${config.presharedKey}`);
  }

  lines.push(
    `Endpoint = ${config.endpoint}`,
    `AllowedIPs = ${config.allowedIps.join(", ")}`,
    `PersistentKeepalive = ${config.persistentKeepalive ?? 25}`
  );

  return `${lines.join("\n")}\n`;
};

const fileExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const isoFromEpochSeconds = (value: string) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
};

const ageFromEpochSeconds = (value: string) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.max(0, Math.floor(Date.now() / 1000) - seconds);
};

const parseDump = (stdout: string): WireGuardPeerStatus[] => {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(1).map((line) => {
    const fields = line.split("\t");
    return {
      publicKey: fields[0] ?? "",
      endpoint: (fields[2] ?? "").trim() || undefined,
      allowedIps: String(fields[3] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      latestHandshakeAt: isoFromEpochSeconds(fields[4] ?? ""),
      latestHandshakeAgeSeconds: ageFromEpochSeconds(fields[4] ?? ""),
    };
  });
};

const refreshServiceState = async () => {
  if (process.platform === "win32") {
    return "manual";
  }

  try {
    const result = await runCommand({
      command: "systemctl",
      args: ["is-active", `wg-quick@${env.WG_INTERFACE_NAME}`],
      timeoutMs: 10_000,
    });
    return result.code === 0 ? result.stdout.trim() || "active" : result.stdout.trim() || "inactive";
  } catch {
    return "unknown";
  }
};

export const getWireGuardStatus = () => wireGuardStatus;

const runWireGuardMutation = async <T>(action: () => Promise<T>) => {
  const previous = wireGuardMutation;
  let release!: () => void;
  wireGuardMutation = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
  }
};

export const persistWireGuardConfig = async (config: RuntimeWireGuardConfig) => {
  await fs.mkdir(path.dirname(env.WG_CONFIG_PATH), { recursive: true });
  await fs.writeFile(env.WG_CONFIG_PATH, buildConfigText(config), {
    encoding: "utf8",
    mode: 0o600,
  });
  setStatus({
    state: "pending",
    interfaceUp: false,
    peers: [],
    message: "WireGuard config written. Waiting for tunnel startup.",
  });
  return env.WG_CONFIG_PATH;
};

export const refreshWireGuardStatus = async () => {
  const configPresent = await fileExists(env.WG_CONFIG_PATH);
  if (!configPresent) {
    setStatus({
      state: "not_configured",
      interfaceUp: false,
      peers: [],
      serviceActive: process.platform === "win32" ? "manual" : "inactive",
      message: "WireGuard config is not present on disk.",
    });
    return wireGuardStatus;
  }

  if (process.platform === "win32") {
    setStatus({
      state: "manual_required",
      interfaceUp: false,
      peers: [],
      serviceActive: "manual",
      message:
        "WireGuard config is present, but helper backend expects the system tunnel to be managed outside Windows runtime mode.",
    });
    return wireGuardStatus;
  }

  const serviceActive = await refreshServiceState();
  let interfaceUp = false;
  let peers: WireGuardPeerStatus[] = [];
  let message = serviceActive === "active" ? "WireGuard service is active." : "WireGuard service is not active yet.";

  try {
    const ipResult = await runCommand({
      command: "ip",
      args: ["link", "show", "dev", env.WG_INTERFACE_NAME],
      timeoutMs: 10_000,
    });
    interfaceUp = ipResult.code === 0;
  } catch {
    interfaceUp = false;
  }

  if (interfaceUp) {
    try {
      const dump = await runCommand({
        command: "wg",
        args: ["show", env.WG_INTERFACE_NAME, "dump"],
        timeoutMs: 10_000,
      });
      if (dump.code === 0) {
        peers = parseDump(dump.stdout);
        if (peers.some((peer) => typeof peer.latestHandshakeAgeSeconds === "number")) {
          message = "WireGuard interface is up and peer handshakes are available.";
        } else {
          message = "WireGuard interface is up, waiting for first handshake.";
        }
      }
    } catch {
      message = "WireGuard interface is up, but peer diagnostics could not be read.";
    }
  }

  setStatus({
    state: interfaceUp ? "up" : serviceActive === "failed" ? "error" : "pending",
    interfaceUp,
    peers,
    serviceActive,
    message,
  });
  return wireGuardStatus;
};

const ensureConnectedInner = async (logger?: Partial<LoggerLike>) => {
  const log = getLogger(logger);

  if (process.platform === "win32") {
    await refreshWireGuardStatus();
    return wireGuardStatus;
  }

  const configPresent = await fileExists(env.WG_CONFIG_PATH);
  if (!configPresent) {
    setStatus({
      state: "not_configured",
      interfaceUp: false,
      peers: [],
      serviceActive: "inactive",
      message: "WireGuard config is missing.",
    });
    return wireGuardStatus;
  }

  const current = await refreshWireGuardStatus();
  if (current.interfaceUp) {
    return current;
  }

  try {
    await runCommand({
      command: "systemctl",
      args: ["enable", `wg-quick@${env.WG_INTERFACE_NAME}`],
      timeoutMs: 15_000,
    }).catch(() => undefined);

    const restartResult = await runCommand({
      command: "systemctl",
      args: ["restart", `wg-quick@${env.WG_INTERFACE_NAME}`],
      timeoutMs: 30_000,
    }).catch(() => undefined);

    if (!restartResult || restartResult.code !== 0) {
      await runCommand({
        command: "wg-quick",
        args: ["down", env.WG_INTERFACE_NAME],
        timeoutMs: 15_000,
      }).catch(() => undefined);

      const upResult = await runCommand({
        command: "wg-quick",
        args: ["up", env.WG_INTERFACE_NAME],
        timeoutMs: 30_000,
      });

      if (upResult.code !== 0) {
        throw new Error(upResult.stderr.trim() || upResult.stdout.trim() || "wg-quick up failed");
      }
    }

    log.info(`WireGuard interface ${env.WG_INTERFACE_NAME} ensured.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown WireGuard error.";
    setStatus({
      state: "error",
      interfaceUp: false,
      peers: [],
      message,
    });
    log.error(`WireGuard ensureConnected failed: ${message}`);
    return wireGuardStatus;
  }

  return refreshWireGuardStatus();
};

export const ensureConnected = async (logger?: Partial<LoggerLike>) =>
  runWireGuardMutation(() => ensureConnectedInner(logger));

const reconnectInner = async (logger?: Partial<LoggerLike>) => {
  const log = getLogger(logger);

  if (process.platform === "win32") {
    await refreshWireGuardStatus();
    return wireGuardStatus;
  }

  try {
    await runCommand({
      command: "systemctl",
      args: ["restart", `wg-quick@${env.WG_INTERFACE_NAME}`],
      timeoutMs: 30_000,
    }).catch(async () => {
      await runCommand({
        command: "wg-quick",
        args: ["down", env.WG_INTERFACE_NAME],
        timeoutMs: 15_000,
      }).catch(() => undefined);

      return runCommand({
        command: "wg-quick",
        args: ["up", env.WG_INTERFACE_NAME],
        timeoutMs: 30_000,
      });
    });
    log.info(`WireGuard interface ${env.WG_INTERFACE_NAME} restarted.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown WireGuard error.";
    setStatus({
      state: "error",
      interfaceUp: false,
      peers: [],
      message,
    });
    log.error(`WireGuard reconnect failed: ${message}`);
    return wireGuardStatus;
  }

  return refreshWireGuardStatus();
};

export const reconnect = async (logger?: Partial<LoggerLike>) =>
  runWireGuardMutation(() => reconnectInner(logger));

export const configureSystemWireGuard = async (
  config: RuntimeWireGuardConfig,
  logger?: Partial<LoggerLike>
) =>
  runWireGuardMutation(async () => {
    await persistWireGuardConfig(config);
    return ensureConnectedInner(logger);
  });
