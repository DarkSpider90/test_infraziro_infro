const API_BASE = "https://api.github.com";

export type WorkflowRun = {
  id: number;
  status: string;
  conclusion: string | null;
  html_url?: string;
  run_number?: number;
  created_at?: string;
  updated_at?: string;
};

export type WorkflowJobStep = {
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

export type WorkflowJob = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  steps?: WorkflowJobStep[];
};

const repoPath = (owner: string, repo: string) =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

const buildHeaders = (token: string): HeadersInit => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
});

const fetchJson = async <T>(url: string, token: string): Promise<T> => {
  const response = await fetch(url, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub request failed: ${response.status} ${response.statusText} ${text}`.trim());
  }
  return (await response.json()) as T;
};

export const getWorkflowRun = async (owner: string, repo: string, token: string, runId: number) =>
  fetchJson<WorkflowRun>(`${API_BASE}${repoPath(owner, repo)}/actions/runs/${runId}`, token);

export const getWorkflowRunJobs = async (
  owner: string,
  repo: string,
  token: string,
  runId: number
) => {
  const data = await fetchJson<{ jobs?: WorkflowJob[] }>(
    `${API_BASE}${repoPath(owner, repo)}/actions/runs/${runId}/jobs?per_page=100`,
    token
  );
  return data.jobs ?? [];
};
