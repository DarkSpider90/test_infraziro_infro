import { getServiceTargets, requireSshConfig, ServiceTarget } from "../config/runtime.js";
import { clamp, safeName } from "../utils/normalize.js";
import { runCommand } from "../utils/shell.js";

type OpsAction = "tail_bootstrap_log" | "docker_logs" | "journal_logs" | "check_service";

const buildSshArgs = (host: string, remoteCommand: string) => {
  const ssh = requireSshConfig();
  return [
    "-i",
    ssh.privateKeyPath,
    "-o",
    `StrictHostKeyChecking=${ssh.strictHostKeyChecking}`,
    `${ssh.user}@${host}`,
    remoteCommand,
  ];
};

const resolveTarget = (target: string): ServiceTarget => {
  const serviceTargets = getServiceTargets();
  if (target in serviceTargets) {
    return target as ServiceTarget;
  }
  throw new Error("Unsupported target.");
};

export const runOpsAction = async ({
  action,
  target,
  lines = 200,
  container,
  unit,
  service,
}: {
  action: OpsAction;
  target: string;
  lines?: number;
  container?: string;
  unit?: string;
  service?: string;
}) => {
  const serviceTargets = getServiceTargets();
  const resolvedTarget = resolveTarget(target);
  const host = serviceTargets[resolvedTarget];
  const limit = clamp(Number(lines) || 200, 1, 1000);

  let remoteCommand = "";
  switch (action) {
    case "tail_bootstrap_log":
      remoteCommand = `sudo tail -n ${limit} /var/log/infrazero-bootstrap.log`;
      break;
    case "docker_logs":
      remoteCommand = `sudo docker logs --tail ${limit} ${safeName(container || "", "container")}`;
      break;
    case "journal_logs":
      remoteCommand = `sudo journalctl -u ${safeName(unit || "", "unit")} -n ${limit} --no-pager`;
      break;
    case "check_service":
      remoteCommand = `sudo systemctl status ${safeName(service || "", "service")} --no-pager`;
      break;
    default:
      throw new Error("Unsupported action.");
  }

  const result = await runCommand({
    command: "ssh",
    args: buildSshArgs(host, remoteCommand),
    timeoutMs: 30_000,
  });

  return {
    target: resolvedTarget,
    action,
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code,
  };
};
