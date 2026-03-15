import { FastifyInstance } from "fastify";

export const registerAuditHooks = (app: FastifyInstance) => {
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
      },
      "request completed"
    );
  });
};
