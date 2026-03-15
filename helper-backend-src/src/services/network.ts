import net from "node:net";

export const checkTcp = (host: string, port: number, timeoutMs = 3_000): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });

export const checkHttp = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok || (response.status >= 300 && response.status < 400);
  } catch {
    return false;
  }
};
