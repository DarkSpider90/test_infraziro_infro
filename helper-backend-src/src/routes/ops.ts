import { FastifyInstance } from "fastify";
import { runOpsAction } from "../services/ssh.js";

export const registerOpsRoutes = async (app: FastifyInstance) => {
  app.post("/api/v1/ops/bootstrap-log", async (request) => {
    const body = request.body as { target: string; lines?: number };
    return runOpsAction({
      action: "tail_bootstrap_log",
      target: body.target,
      lines: body.lines,
    });
  });

  app.post("/api/v1/ops/docker-logs", async (request) => {
    const body = request.body as { target: string; container: string; lines?: number };
    return runOpsAction({
      action: "docker_logs",
      target: body.target,
      container: body.container,
      lines: body.lines,
    });
  });

  app.post("/api/v1/ops/journal-logs", async (request) => {
    const body = request.body as { target: string; unit: string; lines?: number };
    return runOpsAction({
      action: "journal_logs",
      target: body.target,
      unit: body.unit,
      lines: body.lines,
    });
  });

  app.post("/api/v1/ops/check-service", async (request) => {
    const body = request.body as { target: string; service: string };
    return runOpsAction({
      action: "check_service",
      target: body.target,
      service: body.service,
    });
  });
};
