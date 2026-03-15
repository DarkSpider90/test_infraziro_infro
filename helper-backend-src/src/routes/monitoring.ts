import { FastifyInstance } from "fastify";
import { getServiceCandidates, requireGithubConfig, requireRuntimeConfig } from "../config/runtime.js";
import { getWorkflowRun, getWorkflowRunJobs } from "../services/github.js";
import { queryRuntimeLogs } from "../services/loki.js";
import { checkHttp } from "../services/network.js";
import { formatClock, isoToMillis } from "../utils/time.js";

export const registerMonitoringRoutes = async (app: FastifyInstance) => {
  const tryRuntimeLogs = async (lokiUrls: string[], limit: number, sinceSeconds: number) => {
    const failures: string[] = [];

    for (const lokiUrl of lokiUrls) {
      try {
        const entries = await queryRuntimeLogs({
          lokiUrl,
          limit,
          sinceSeconds,
        });
        return { entries, sourceUrl: lokiUrl, failures };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Loki request failed.";
        failures.push(`${lokiUrl}: ${message}`);
      }
    }

    return { entries: null, sourceUrl: null, failures };
  };

  const checkFirstReachable = async (urls: string[]) => {
    for (const url of urls) {
      if (await checkHttp(url)) {
        return { reachable: true, activeUrl: url };
      }
    }

    return { reachable: false, activeUrl: urls[0] ?? "" };
  };

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
    const serviceCandidates = getServiceCandidates();
    const query = request.query as { limit?: string; sinceSeconds?: string };
    const limit = query.limit ? Number(query.limit) : 120;
    const sinceSeconds = query.sinceSeconds ? Number(query.sinceSeconds) : 3600;
    const result = await tryRuntimeLogs(serviceCandidates.loki, limit, sinceSeconds);

    if (result.entries) {
      return { entries: result.entries, sourceUrl: result.sourceUrl };
    }

    const failureText = result.failures.join(" | ") || "No Loki endpoints were configured.";
    app.log.warn({ failures: result.failures }, "Runtime log query failed");
    return {
      entries: [
        {
          timestamp: formatClock(new Date()),
          sortAt: Date.now(),
          tag: "[LOKI]",
          status: "ERROR" as const,
          message: `Loki runtime logs are unavailable: ${failureText}`,
        },
      ],
      degraded: true,
    };
  });

  app.get("/api/v1/monitoring/services", async () => {
    const config = requireRuntimeConfig("Service monitoring");
    const serviceCandidates = getServiceCandidates();
    const [grafana, loki, infisical] = await Promise.all([
      checkFirstReachable(serviceCandidates.grafana.map((url) => `${url.replace(/\/+$/, "")}/api/health`)),
      checkFirstReachable(serviceCandidates.loki.map((url) => `${url.replace(/\/+$/, "")}/ready`)),
      checkFirstReachable(serviceCandidates.infisical.map((url) => `${url.replace(/\/+$/, "")}/api/status`)),
    ]);

    return {
      grafana: { reachable: grafana.reachable, url: grafana.activeUrl || config.network.grafanaUrl },
      loki: { reachable: loki.reachable, url: loki.activeUrl || config.network.lokiUrl },
      infisical: { reachable: infisical.reachable, url: infisical.activeUrl || config.network.infisicalUrl },
    };
  });
};
