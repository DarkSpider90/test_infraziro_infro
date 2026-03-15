import { spawn } from "node:child_process";

export const runCommand = async ({
  command,
  args,
  timeoutMs = 20_000,
  maxOutputBytes = 64 * 1024,
}: {
  command: string;
  args: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<{ stdout: string; stderr: string; code: number; truncated: boolean }> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    const append = (current: string, chunk: string) => {
      if (current.length >= maxOutputBytes) {
        truncated = true;
        return current;
      }
      const remaining = maxOutputBytes - current.length;
      if (chunk.length > remaining) {
        truncated = true;
        return `${current}${chunk.slice(0, remaining)}`;
      }
      return `${current}${chunk}`;
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, String(chunk));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        code: code ?? 1,
        truncated,
      });
    });
  });
