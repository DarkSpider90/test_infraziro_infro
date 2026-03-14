import { FastifyInstance } from "fastify";
import { getRuntimeNetwork, getRuntimeState, getServiceTargets, isRuntimeConfigured } from "../config/runtime.js";
import { checkTcp } from "../services/network.js";

export const registerHealthRoutes = async (app: FastifyInstance) => {
  app.get("/api/v1/health", async () => {
    const state = getRuntimeState();
    return {
      ok: isRuntimeConfigured(),
      service: "infrazero-backend",
      version: "0.1.0",
      status: state.mode,
      source: state.source,
      wireguard: state.wireguard,
    };
  });

  app.get("/api/v1/network/status", async () => {
    const state = getRuntimeState();
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
      wireguard: state.wireguard,
      internalNetworkCidr: network.internalNetworkCidr,
      wgNetworkCidr: network.wgNetworkCidr,
      hosts,
    };
  });
};
