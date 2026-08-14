import { Queue, type ConnectionOptions } from "bullmq";
import { DEFAULT_JOB_OPTIONS } from "./connection.js";
import { QUEUE_NAME, type StatsUpdateJobData } from "../jobs/stats-updates.job.js";

export function createStatsUpdatesQueue(connection: ConnectionOptions): Queue<StatsUpdateJobData> {
  return new Queue<StatsUpdateJobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}
