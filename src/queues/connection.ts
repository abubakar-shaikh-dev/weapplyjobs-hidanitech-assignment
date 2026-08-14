import { Redis } from "ioredis";
import type { JobsOptions } from "bullmq";
import { env } from "../config/env.js";

export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
};
