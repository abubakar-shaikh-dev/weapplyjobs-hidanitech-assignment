import { buildServer } from "./server.js";
import { env } from "./config/env.js";

const server = buildServer({ logger: true });

try {
  await server.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
