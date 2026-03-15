export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const ensureUrl = (value: string): string =>
  /^https?:\/\//i.test(value) ? value : `http://${value}`;

export const safeName = (value: string, label: string): string => {
  const trimmed = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9_.:@-]+$/.test(trimmed)) {
    throw new Error(`Invalid ${label}.`);
  }
  return trimmed;
};
