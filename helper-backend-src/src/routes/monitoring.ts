import { FastifyInstance } from "fastify";
import { getInternalServices, requireGithubConfig, requireRuntimeConfig } from "../config/runtime.js";
import { getWorkflowRun, getWorkflowRunJobs } from "../services/github.js";
import { queryRuntimeLogs } from "../services/loki.js";
import { checkHttp } from "../services/network.js";
import { formatClock, isoToMillis } from "../utils/time.js";

export const registerMonitoringRoutes = async (app: FastifyInstance) => {
  app.get("/api/v1/monitoring/workflow/:runId", async (request) => {
    const github = requireGithubConfig();
    const runId = Number((request.params as { runId: string }).runId);
    const [run, jobs] = await Promise.all([
      getWorkflowRun(github.owner, github.infraRepo, github.token, runId),
      getWorkflowRunJobs(github.owner, github.infraRepo, github.token, runId),
    ]);
    return { run, jobs };
  });

  app.get("/api/v1/monitoring/workflow/:runId/logs", async (request) => {
    const github = requireGithubConfig();
    const runId = Number((request.params as { runId: string }).runId);
    const jobs = await getWorkflowRunJobs(github.owner, github.infraRepo, github.token, runId);

    const entries = jobs
      .flatMap((job) =>
        (job.steps ?? []).map((step) => {
          const sortAt = isoToMillis(step.started_at || step.completed_at);
          const status =
            step.conclusion === "failure"
              ? "ERROR"
              : step.status === "in_progress"
                ? "RUN"
                : step.conclusion === "success"
                  ? "SUCCESS"
                  : "INFO";
          return {
            timestamp: formatClock(new Date(sortAt)),
            sortAt,
            tag: `[${job.name.toUpperCase().replace(/[^A-Z0-9:]+/g, "-")}]`,
            status,
            message: step.name,
          };
        })
      )
      .sort((left, right) => left.sortAt - right.sortAt);

    return { entries };
  });

  app.get("/api/v1/monitoring/runtime-logs", async (request) => {
    const config = requireRuntimeConfig("Runtime logs");
    const query = request.query as { limit?: string; sinceSeconds?: string };
    const limit = query.limit ? Number(query.limit) : 120;
    const sinceSeconds = query.sinceSeconds ? Number(query.sinceSeconds) : 3600;
    const entries = await queryRuntimeLogs({
      lokiUrl: config.network.lokiUrl,
      limit,
      sinceSeconds,
    });
    return { entries };
  });

  app.get("/api/v1/monitoring/services", async () => {
    const config = requireRuntimeConfig("Service monitoring");
    const internalServices = getInternalServices();
    const [grafana, loki, infisical] = await Promise.all([
      checkHttp(internalServices.grafana),
      checkHttp(internalServices.loki),
      checkHttp(internalServices.infisical),
    ]);

    return {
      grafana: { reachable: grafana, url: config.network.grafanaUrl },
      loki: { reachable: loki, url: config.network.lokiUrl },
      infisical: { reachable: infisical, url: config.network.infisicalUrl },
    };
  });
};
