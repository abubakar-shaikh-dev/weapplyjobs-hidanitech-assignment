import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Queue } from "bullmq";

interface QueueCounts {
  waiting: number;
  active: number;
  failed: number;
}

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

    const queues: Record<string, QueueCounts> = {};

    if (redis === "connected") {
      const queueEntries: [string, Queue][] = [
        ["notifications", fastify.queues.notifications],
        ["stats-updates", fastify.queues.statsUpdates],
        ["audit-logs", fastify.queues.auditLogs],
      ];

      for (const [name, queue] of queueEntries) {
        try {
          const counts = await queue.getJobCounts("waiting", "active", "failed");
          queues[name] = {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            failed: counts.failed ?? 0,
          };
        } catch {
          queues[name] = { waiting: 0, active: 0, failed: 0 };
        }
      }
    }

    const degraded = db === "disconnected" || redis === "disconnected";

    if (degraded) {
      reply.status(503);
    }

    return {
      status: degraded ? "degraded" : "ok",
      db,
      redis,
      queues,
      uptime: Math.floor(process.uptime()),
    };
  };
}
