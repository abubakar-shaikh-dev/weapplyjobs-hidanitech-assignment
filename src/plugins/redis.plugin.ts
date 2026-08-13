import fp from "fastify-plugin";
import fastifyRedis from "@fastify/redis";
import { env } from "../config/env.js";

export default fp(
  async function redisPlugin(fastify) {
    await fastify.register(fastifyRedis, {
      url: env.REDIS_URL,
      maxRetriesPerRequest: null,
    });

    fastify.log.info("Redis connected");
  },
  {
    name: "redis-plugin",
  },
);
