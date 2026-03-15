export const sanitizeUrlForLogs = (value: string): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;

  try {
    const url = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "http://localhost");
    const redactedKeys = ["token", "authorization", "apiToken"];
    redactedKeys.forEach((key) => {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    });
    const sanitized = `${url.pathname}${url.search}${url.hash}`;
    return raw.startsWith("http://") || raw.startsWith("https://")
      ? url.toString()
      : sanitized;
  } catch {
    return raw.replace(/([?&](?:token|authorization|apiToken)=)[^&]+/gi, "$1[redacted]");
  }
};
