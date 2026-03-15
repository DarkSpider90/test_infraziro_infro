import { FastifyReply, FastifyRequest } from "fastify";
import { getAuthToken, isRuntimeConfigured } from "../config/runtime.js";

export const verifyBearer = async (request: FastifyRequest, reply: FastifyReply) => {
  if (request.url === "/api/v1/health" || request.url === "/api/v1/bootstrap/status") {
    return;
  }

  if (request.url === "/api/v1/bootstrap/configure" && !isRuntimeConfigured()) {
    return;
  }

  if (request.url.startsWith("/grafana")) {
    const token = String((request.query as { token?: string } | undefined)?.token ?? "");
    if (token && token === getAuthToken()) {
      return;
    }
  }

  const header = String(request.headers.authorization ?? "");
  const expected = `Bearer ${getAuthToken()}`;
  if (header !== expected) {
    await reply.code(401).send({ error: "Unauthorized" });
  }
};
