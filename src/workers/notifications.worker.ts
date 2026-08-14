import { Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  INTENTIONAL_FAILURE_JOB_NAME,
  QUEUE_NAME,
  type NotificationJobData,
} from "../jobs/notifications.job.js";

export async function processNotificationJob(job: Job<NotificationJobData>): Promise<void> {
  if (job.name === INTENTIONAL_FAILURE_JOB_NAME) {
    throw new Error("intentional failure for retry demo");
  }

  console.log(`[notifications] processing job ${job.id}:`, job.data);
}

export function createNotificationsWorker(connection: ConnectionOptions): Worker<NotificationJobData> {
  return new Worker<NotificationJobData>(QUEUE_NAME, processNotificationJob, { connection });
}
