import fp from "fastify-plugin";
import { createAllQueues, type Queues } from "../queues/index.js";
import { createAllWorkers, type Workers } from "../workers/index.js";

declare module "fastify" {
  interface FastifyInstance {
    queues: Queues;
    workers: Workers;
  }
}

export default fp(
  async function queuePlugin(fastify) {
    const queues = createAllQueues(fastify.redis);
    const workers = createAllWorkers(queues.deadLetter);

    fastify.decorate("queues", queues);
    fastify.decorate("workers", workers);

    fastify.log.info("Queue workers started");

    fastify.addHook("onClose", async () => {
      await workers.close();
      await queues.notifications.close();
      await queues.statsUpdates.close();
      await queues.auditLogs.close();
      await queues.deadLetter.close();
    });
  },
  {
    name: "queue-plugin",
  },
);
