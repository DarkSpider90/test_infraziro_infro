import { formatClock } from "../utils/time.js";

export type RuntimeLogEntry = {
  timestamp: string;
  tag: string;
  status: "INFO" | "RUN" | "SUCCESS" | "ERROR";
  message: string;
  sortAt: number;
};

const runtimeTag = (message: string): string => {
  const text = message.toLowerCase();
  if (text.includes("grafana")) return "[GRAFANA]";
  if (text.includes("loki")) return "[LOKI]";
  if (text.includes("argocd")) return "[ARGOCD]";
  if (text.includes("infisical")) return "[INFISICAL]";
  if (text.includes("cloud-init")) return "[CLOUD-INIT]";
  if (text.includes("ssh") || text.includes("login")) return "[SSH]";
  if (text.includes("docker") || text.includes("container")) return "[DOCKER]";
  if (text.includes("postgres")) return "[POSTGRES]";
  if (text.includes("redis")) return "[REDIS]";
  return "[MONITORING]";
};

const runtimeStatus = (message: string): RuntimeLogEntry["status"] => {
  const text = message.toLowerCase();
  if (/(failed|error|fatal|denied)/i.test(text)) return "ERROR";
  if (/(started|starting|sync|provision|bootstrap|init)/i.test(text)) return "RUN";
  if (/(ready|healthy|completed|available|success)/i.test(text)) return "SUCCESS";
  return "INFO";
};

const nanosToMillis = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000_000) : Date.now();
};

export const queryRuntimeLogs = async ({
  lokiUrl,
  limit = 120,
  sinceSeconds = 3600,
}: {
  lokiUrl: string;
  limit?: number;
  sinceSeconds?: number;
}): Promise<RuntimeLogEntry[]> => {
  const end = `${Date.now()}000000`;
  const start = `${Date.now() - sinceSeconds * 1000}000000`;
  const url =
    `${lokiUrl.replace(/\/+$/, "")}/loki/api/v1/query_range` +
    `?query=${encodeURIComponent('{job=~".+"}')}` +
    `&limit=${limit}&direction=BACKWARD&start=${start}&end=${end}`;

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Loki request failed: ${response.status} ${response.statusText} ${text}`.trim());
  }

  const data = (await response.json()) as {
    data?: { result?: Array<{ values?: Array<[string, string]> }> };
  };

  const entries: RuntimeLogEntry[] = [];
  for (const stream of data.data?.result ?? []) {
    for (const [timestamp, message] of stream.values ?? []) {
      const sortAt = nanosToMillis(timestamp);
      entries.push({
        timestamp: formatClock(new Date(sortAt)),
        tag: runtimeTag(message),
        status: runtimeStatus(message),
        message: message.trim(),
        sortAt,
      });
    }
  }

  return entries.sort((left, right) => left.sortAt - right.sortAt);
};
