import { randomUUID } from "node:crypto";

export type ManagedJobStatus = "queued" | "running" | "completed" | "failed";

export type ManagedJobRecord<TResult = unknown> = {
  id: string;
  type: string;
  status: ManagedJobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: TResult;
  error?: string;
};

const MAX_STORED_JOBS = 100;
const jobs = new Map<string, ManagedJobRecord>();

const now = () => new Date().toISOString();

const pruneJobs = () => {
  while (jobs.size > MAX_STORED_JOBS) {
    const firstKey = jobs.keys().next().value as string | undefined;
    if (!firstKey) break;
    jobs.delete(firstKey);
  }
};

export const queueManagedJob = <TResult>({
  type,
  handler,
}: {
  type: string;
  handler: () => Promise<TResult>;
}): ManagedJobRecord<TResult> => {
  const id = randomUUID();
  const job: ManagedJobRecord<TResult> = {
    id,
    type,
    status: "queued",
    createdAt: now(),
  };
  jobs.set(id, job);
  pruneJobs();

  void (async () => {
    job.status = "running";
    job.startedAt = now();
    try {
      job.result = await handler();
      job.status = "completed";
      job.completedAt = now();
    } catch (error) {
      job.status = "failed";
      job.completedAt = now();
      job.error = error instanceof Error ? error.message : "Job failed.";
    }
  })();

  return { ...job };
};

export const getManagedJob = (id: string) => {
  const job = jobs.get(id);
  return job ? { ...job } : null;
};

export const listManagedJobs = (limit = 25) =>
  Array.from(jobs.values())
    .slice(-Math.max(1, Math.min(limit, MAX_STORED_JOBS)))
    .reverse()
    .map((job) => ({ ...job }));
