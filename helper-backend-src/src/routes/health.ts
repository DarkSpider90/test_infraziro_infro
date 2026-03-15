import { FastifyInstance } from "fastify";
import { getRuntimeNetwork, getRuntimeState, getServiceTargets, isRuntimeConfigured } from "../config/runtime.js";
import { checkTcp } from "../services/network.js";
import { refreshWireGuardStatus } from "../services/wireguard.js";

export const registerHealthRoutes = async (app: FastifyInstance) => {
  const buildHealthPayload = async () => {
    const state = getRuntimeState();
    const wireguard = await refreshWireGuardStatus();
    const ready =
      isRuntimeConfigured() &&
      (!state.config?.wireguard || wireguard.state === "up");

    return {
      ok: true,
      service: "infrazero-backend",
      version: "0.1.0",
      status: state.mode,
      ready,
      source: state.source,
      wireguard,
    };
  };

  const buildReadyPayload = async () => {
    const state = getRuntimeState();
    const wireguard = await refreshWireGuardStatus();
    const ok =
      isRuntimeConfigured() &&
      (!state.config?.wireguard || wireguard.state === "up");

    return {
      ok,
      service: "infrazero-backend",
      status: ok ? "ready" : state.mode,
      source: state.source,
      wireguard,
    };
  };

  app.get("/health", buildHealthPayload);
  app.get("/api/v1/health", buildHealthPayload);
  app.get("/ready", buildReadyPayload);
  app.get("/api/v1/ready", buildReadyPayload);

  app.get("/wireguard/status", async () => {
    return refreshWireGuardStatus();
  });

  app.get("/api/v1/wireguard/status", async () => {
    return refreshWireGuardStatus();
  });

  app.get("/api/v1/network/status", async () => {
    const wireguard = await refreshWireGuardStatus();
    const network = getRuntimeNetwork();
    const serviceTargets = getServiceTargets();
    const hosts = Object.fromEntries(
      await Promise.all(
        Object.entries(serviceTargets).map(async ([name, host]) => [
          name,
          {
            host,
            reachable: await checkTcp(host, 22),
          },
        ])
      )
    );

    return {
      wireguard,
      internalNetworkCidr: network.internalNetworkCidr,
      wgNetworkCidr: network.wgNetworkCidr,
      hosts,
    };
  });
};
