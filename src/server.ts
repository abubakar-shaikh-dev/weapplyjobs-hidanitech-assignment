import Fastify from "fastify";
import zodPlugin from "./plugins/zod.plugin.js";
import errorHandlerPlugin from "./plugins/error-handler.plugin.js";

interface ServerOptions {
  logger?: boolean;
}

export function buildServer(options: ServerOptions = {}) {
  const server = Fastify({
    logger: options.logger ?? true,
  });

  server.register(zodPlugin);
  server.register(errorHandlerPlugin);

  return server;
}
