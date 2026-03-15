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
    const query = request.query as { replace?: string | boolean };
    const body = (request.body ?? {}) as BootstrapPayload & { replace?: boolean };
    const replace =
      body.replace === true ||
      query.replace === true ||
      String(query.replace ?? "").trim().toLowerCase() === "true";
    const result = await configureRuntime(body, app.log, { replace });
    const state = getRuntimeState();

    return {
      configured: true,
      status: state.mode,
      source: state.source,
      wireguard: state.wireguard,
      reused: result.reused,
      replaced: result.replaced,
      network: result.config.network,
      github: Boolean(result.config.github),
      s3: Boolean(result.config.s3),
      ssh: Boolean(result.config.ssh),
    };
  });
};
