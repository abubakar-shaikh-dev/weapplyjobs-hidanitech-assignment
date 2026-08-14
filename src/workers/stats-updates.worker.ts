import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { QUEUE_NAME, type StatsUpdateJobData } from "../jobs/stats-updates.job.js";

export async function processStatsUpdateJob(job: Job<StatsUpdateJobData>): Promise<void> {
  console.log(`[stats-updates] processing job ${job.id}:`, job.data);
}

export function createStatsUpdatesWorker(connection: ConnectionOptions): Worker<StatsUpdateJobData> {
  return new Worker<StatsUpdateJobData>(QUEUE_NAME, processStatsUpdateJob, { connection });
}
