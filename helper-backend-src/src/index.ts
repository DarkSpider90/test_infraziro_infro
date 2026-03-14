import "dotenv/config";
import { env, getEnvWarnings } from "./config/env.js";
import { buildApp } from "./app.js";
import { initializeRuntimeConfig } from "./config/runtime.js";

const app = buildApp();
const envWarnings = getEnvWarnings();

const start = async () => {
  try {
    if (envWarnings.length) {
      envWarnings.forEach((warning) => app.log.warn(warning));
      app.log.warn(
        "Helper backend started with development fallback env values. Exported backend bundles will provide real project-specific settings."
      );
    }
    await initializeRuntimeConfig(app.log);
    await app.listen({
      host: "0.0.0.0",
      port: env.PORT,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
