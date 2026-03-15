import { FastifyInstance } from "fastify";
import { configureRuntime, getRuntimeState, isRuntimeConfigured, type BootstrapPayload } from "../config/runtime.js";

export const registerBootstrapRoutes = async (app: FastifyInstance) => {
  app.get("/api/v1/bootstrap/status", async () => {
    const state = getRuntimeState();
    return {
      configured: isRuntimeConfigured(),
      status: state.mode,
      source: state.source,
      wireguard: state.wireguard,
    };
  });

  app.post("/api/v1/bootstrap/configure", async (request) => {
    const body = (request.body ?? {}) as BootstrapPayload;
    const config = await configureRuntime(body, app.log);
    const state = getRuntimeState();

    return {
      configured: true,
      status: state.mode,
      source: state.source,
      wireguard: state.wireguard,
      network: config.network,
      github: Boolean(config.github),
      s3: Boolean(config.s3),
      ssh: Boolean(config.ssh),
    };
  });
};
