import { FastifyInstance } from "fastify";

export const registerErrorHandler = (app: FastifyInstance) => {
  app.setErrorHandler(async (error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    const message = error instanceof Error ? error.message : "Internal Server Error";
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? ((error as { statusCode: number }).statusCode)
        : 500;
    await reply.code(statusCode).send({
      error: message,
    });
  });
};
