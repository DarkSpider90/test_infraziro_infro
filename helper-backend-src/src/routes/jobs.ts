import { FastifyInstance } from "fastify";
import { queueManagedJob, getManagedJob, listManagedJobs } from "../services/jobs.js";
import { runOpsAction } from "../services/ssh.js";
import { ensureConnected, reconnect } from "../services/wireguard.js";

type CreateJobBody =
  | { type: "ops.tail_bootstrap_log"; target: string; lines?: number }
  | { type: "ops.docker_logs"; target: string; container: string; lines?: number }
  | { type: "ops.journal_logs"; target: string; unit: string; lines?: number }
  | { type: "ops.check_service"; target: string; service: string }
  | { type: "wireguard.ensure" }
  | { type: "wireguard.reconnect" };

export const registerJobRoutes = async (app: FastifyInstance) => {
  app.get("/api/v1/jobs", async (request) => {
    const query = request.query as { limit?: string };
    const limit = query.limit ? Number(query.limit) : 25;
    return { jobs: listManagedJobs(limit) };
  });

  app.get("/api/v1/jobs/:jobId", async (request) => {
    const jobId = String((request.params as { jobId: string }).jobId ?? "").trim();
    const job = getManagedJob(jobId);
    if (!job) {
      throw Object.assign(new Error("Job not found."), { statusCode: 404 });
    }
    return job;
  });

  app.post("/api/v1/jobs", async (request, reply) => {
    const body = (request.body ?? {}) as Partial<CreateJobBody> & { type?: string };

    const job = (() => {
      switch (body.type) {
        case "ops.tail_bootstrap_log": {
          const payload = body as Extract<CreateJobBody, { type: "ops.tail_bootstrap_log" }>;
          return queueManagedJob({
            type: body.type,
            handler: () =>
              runOpsAction({
                action: "tail_bootstrap_log",
                target: payload.target,
                lines: payload.lines,
              }),
          });
        }
        case "ops.docker_logs": {
          const payload = body as Extract<CreateJobBody, { type: "ops.docker_logs" }>;
          return queueManagedJob({
            type: body.type,
            handler: () =>
              runOpsAction({
                action: "docker_logs",
                target: payload.target,
                container: payload.container,
                lines: payload.lines,
              }),
          });
        }
        case "ops.journal_logs": {
          const payload = body as Extract<CreateJobBody, { type: "ops.journal_logs" }>;
          return queueManagedJob({
            type: body.type,
            handler: () =>
              runOpsAction({
                action: "journal_logs",
                target: payload.target,
                unit: payload.unit,
                lines: payload.lines,
              }),
          });
        }
        case "ops.check_service": {
          const payload = body as Extract<CreateJobBody, { type: "ops.check_service" }>;
          return queueManagedJob({
            type: body.type,
            handler: () =>
              runOpsAction({
                action: "check_service",
                target: payload.target,
                service: payload.service,
              }),
          });
        }
        case "wireguard.ensure":
          return queueManagedJob({
            type: body.type,
            handler: () => ensureConnected(app.log),
          });
        case "wireguard.reconnect":
          return queueManagedJob({
            type: body.type,
            handler: () => reconnect(app.log),
          });
        default:
          throw Object.assign(new Error("Unsupported job type."), { statusCode: 400 });
      }
    })();

    reply.code(202);
    return job;
  });
};
