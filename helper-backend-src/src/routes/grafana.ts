import { Readable } from "node:stream";
import { FastifyInstance } from "fastify";
import { getRuntimeNetwork, requireRuntimeConfig } from "../config/runtime.js";

export const registerGrafanaProxy = async (app: FastifyInstance) => {
  const handler = async (request: any, reply: any) => {
    const config = requireRuntimeConfig("Grafana proxy");
    const network = getRuntimeNetwork();
    const rawUrl = String(request.raw.url ?? "/grafana/");
    const suffix = rawUrl.replace(/^\/grafana/, "") || "/";
    const upstreamBases = [config.network.grafanaUrl, network.grafanaPublicUrl].filter(Boolean) as string[];

    const headers = new Headers();
    Object.entries(request.headers).forEach(([name, value]) => {
      if (!value) return;
      if (["host", "content-length", "connection"].includes(name.toLowerCase())) return;
      if (Array.isArray(value)) {
        value.forEach((entry) => headers.append(name, entry));
        return;
      }
      headers.set(name, String(value));
    });
    headers.set("x-forwarded-proto", request.protocol);
    headers.set("x-forwarded-host", request.hostname);

    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
      init.body = request.raw;
      init.duplex = "half";
    }

    let response: Response | null = null;
    let upstreamBase = "";
    let lastError: Error | null = null;

    for (const candidate of upstreamBases) {
      const nextBase = candidate.replace(/\/+$/, "");
      const targetUrl = new URL(suffix.startsWith("/") ? suffix : `/${suffix}`, `${nextBase}/`);

      try {
        const candidateResponse = await fetch(targetUrl, init);
        if (candidateResponse.status >= 500) {
          lastError = new Error(`Upstream responded with ${candidateResponse.status}`);
          continue;
        }
        response = candidateResponse;
        upstreamBase = nextBase;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Fetch failed");
      }
    }

    if (!response) {
      app.log.warn({ err: lastError, upstreamBases }, "Grafana proxy upstream fetch failed");
      reply.code(502);
      return reply.send({
        error: "Fetch failed",
        message: lastError?.message ?? "Grafana upstream is unreachable.",
      });
    }

    reply.code(response.status);
    response.headers.forEach((value, name) => {
      if (name.toLowerCase() === "location" && value.startsWith(upstreamBase)) {
        reply.header(name, value.replace(upstreamBase, "/grafana"));
        return;
      }
      if (name.toLowerCase() === "content-length") {
        return;
      }
      reply.header(name, value);
    });

    if (!response.body) {
      return reply.send();
    }

    return reply.send(Readable.fromWeb(response.body as any));
  };

  app.route({
    method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    url: "/grafana",
    handler,
  });

  app.route({
    method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    url: "/grafana/*",
    handler,
  });
};
