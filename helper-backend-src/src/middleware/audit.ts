import { FastifyInstance } from "fastify";
import { sanitizeUrlForLogs } from "../utils/redact.js";

export const registerAuditHooks = (app: FastifyInstance) => {
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        url: sanitizeUrlForLogs(request.url),
        statusCode: reply.statusCode,
      },
      "request completed"
    );
  });
};
