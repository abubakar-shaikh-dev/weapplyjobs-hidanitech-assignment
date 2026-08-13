import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type Connectivity = "connected" | "disconnected";

export function healthHandler(fastify: FastifyInstance) {
  return async function handler(request: FastifyRequest, reply: FastifyReply) {
    let db: Connectivity = "connected";
    try {
      await fastify.db.$queryRaw`SELECT 1`;
    } catch {
      db = "disconnected";
    }

    let redis: Connectivity = "connected";
    try {
      await fastify.redis.ping();
    } catch {
      redis = "disconnected";
    }

    const degraded = db === "disconnected" || redis === "disconnected";

    if (degraded) {
      reply.status(503);
    }

    return {
      status: degraded ? "degraded" : "ok",
      db,
      redis,
      uptime: Math.floor(process.uptime()),
    };
  };
}
