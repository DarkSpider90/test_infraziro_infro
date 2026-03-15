import { Readable } from "node:stream";
import { FastifyInstance } from "fastify";
import { requireRuntimeConfig } from "../config/runtime.js";

export const registerGrafanaProxy = async (app: FastifyInstance) => {
  const handler = async (request: any, reply: any) => {
    const config = requireRuntimeConfig("Grafana proxy");
    const rawUrl = String(request.raw.url ?? "/grafana/");
    const suffix = rawUrl.replace(/^\/grafana/, "") || "/";
    const upstreamBase = config.network.grafanaUrl.replace(/\/+$/, "");
    const targetUrl = new URL(suffix.startsWith("/") ? suffix : `/${suffix}`, `${upstreamBase}/`);

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

    const response = await fetch(targetUrl, init);

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
