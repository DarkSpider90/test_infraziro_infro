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

export type WireGuardState = "not_configured" | "pending" | "up" | "manual_required" | "error";

export type WireGuardStatus = {
  state: WireGuardState;
  message?: string;
  configPath?: string;
  updatedAt?: string;
};

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

let wireGuardStatus: WireGuardStatus = {
  state: "not_configured",
};

const getLogger = (logger?: Partial<LoggerLike>): LoggerLike => ({
  info: (message: string) => logger?.info?.(message) ?? console.log(message),
  warn: (message: string) => logger?.warn?.(message) ?? console.warn(message),
  error: (message: string) => logger?.error?.(message) ?? console.error(message),
});

const setStatus = (status: WireGuardStatus) => {
  wireGuardStatus = {
    ...status,
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

export const getWireGuardStatus = () => wireGuardStatus;

export const persistWireGuardConfig = async (config: RuntimeWireGuardConfig) => {
  await fs.mkdir(path.dirname(env.WG_CONFIG_PATH), { recursive: true });
  await fs.writeFile(env.WG_CONFIG_PATH, buildConfigText(config), "utf8");
  setStatus({
    state: "pending",
    configPath: env.WG_CONFIG_PATH,
    message: "WireGuard config written. Waiting for tunnel startup.",
  });
  return env.WG_CONFIG_PATH;
};

export const ensureWireGuardConfigured = async (
  config: RuntimeWireGuardConfig,
  logger?: Partial<LoggerLike>
) => {
  const log = getLogger(logger);
  const configPath = await persistWireGuardConfig(config);

  if (process.platform === "win32") {
    setStatus({
      state: "manual_required",
      configPath,
      message:
        "WireGuard config is ready, but automatic tunnel startup is not implemented for Windows. Import the generated config into WireGuard for Windows.",
    });
    log.warn("WireGuard config prepared. Manual activation is required on Windows.");
    return getWireGuardStatus();
  }

  try {
    await runCommand({
      command: "wg-quick",
      args: ["down", configPath],
      timeoutMs: 15_000,
    }).catch(() => undefined);

    const result = await runCommand({
      command: "wg-quick",
      args: ["up", configPath],
      timeoutMs: 30_000,
    });

    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "wg-quick up failed");
    }

    setStatus({
      state: "up",
      configPath,
      message: "WireGuard tunnel is up.",
    });
    log.info("WireGuard tunnel is up.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown WireGuard error.";
    setStatus({
      state: "error",
      configPath,
      message,
    });
    log.error(`WireGuard startup failed: ${message}`);
  }

  return getWireGuardStatus();
};
