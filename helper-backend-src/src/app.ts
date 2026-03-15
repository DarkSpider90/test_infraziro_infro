import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { env } from "./config/env.js";
import { registerAuditHooks } from "./middleware/audit.js";
import { verifyBearer } from "./middleware/auth.js";
import { registerErrorHandler } from "./middleware/errors.js";
import { registerBackupRoutes } from "./routes/backups.js";
import { registerBootstrapRoutes } from "./routes/bootstrap.js";
import { registerGrafanaProxy } from "./routes/grafana.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMonitoringRoutes } from "./routes/monitoring.js";
import { registerOpsRoutes } from "./routes/ops.js";

export const buildApp = () => {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
    bodyLimit: 1024 * 1024 * 1024,
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (request.method === "OPTIONS") {
      reply.code(204).send();
    }
  });

  registerAuditHooks(app);
  registerErrorHandler(app);
  app.addHook("onRequest", verifyBearer);

  app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 5 * 1024 * 1024 * 1024,
    },
  });

  app.register(registerHealthRoutes);
  app.register(registerBootstrapRoutes);
  app.register(registerMonitoringRoutes);
  app.register(registerOpsRoutes);
  app.register(registerBackupRoutes);
  app.register(registerGrafanaProxy);

  return app;
};
