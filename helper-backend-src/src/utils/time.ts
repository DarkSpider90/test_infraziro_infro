export const isoToMillis = (value?: string | null): number =>
  value ? new Date(value).getTime() : Date.now();

export const formatClock = (date: Date): string =>
  date.toISOString().slice(11, 19);
