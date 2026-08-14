import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { QUEUE_NAME, type DeadLetterJobData } from "../jobs/dead-letter.job.js";

export async function processDeadLetterJob(job: Job<DeadLetterJobData>): Promise<void> {
  const { sourceQueue, originalJobId, originalName, error, attemptsMade } = job.data;
  console.log(
    `[dead-letter] job ${originalJobId ?? "?"} (${originalName}) from ${sourceQueue} failed after ${attemptsMade} attempts: ${error.message}`,
  );
}

export function createDeadLetterWorker(connection: ConnectionOptions): Worker<DeadLetterJobData> {
  return new Worker<DeadLetterJobData>(QUEUE_NAME, processDeadLetterJob, { connection });
}
