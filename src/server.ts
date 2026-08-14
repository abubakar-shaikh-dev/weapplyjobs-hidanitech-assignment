import Fastify from "fastify";
import zodPlugin from "./plugins/zod.plugin.js";
import dbPlugin from "./plugins/db.plugin.js";
import errorHandlerPlugin from "./plugins/error-handler.plugin.js";
import redisPlugin from "./plugins/redis.plugin.js";
import applicationsRoutes from "./routes/applications.route.js";
import healthRoutes from "./routes/health.route.js";

interface ServerOptions {
  logger?: boolean;
}

export function buildServer(options: ServerOptions = {}) {
  const server = Fastify({
    logger: options.logger ?? true,
  });

  server.register(zodPlugin);
  server.register(errorHandlerPlugin);
  server.register(dbPlugin);
  server.register(redisPlugin);
  server.register(applicationsRoutes);
  server.register(healthRoutes);

  return server;
}
