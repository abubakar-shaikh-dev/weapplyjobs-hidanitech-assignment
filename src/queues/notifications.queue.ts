import { Queue, type ConnectionOptions } from "bullmq";
import { DEFAULT_JOB_OPTIONS } from "./connection.js";
import { QUEUE_NAME, type NotificationJobData } from "../jobs/notifications.job.js";

export function createNotificationsQueue(connection: ConnectionOptions): Queue<NotificationJobData> {
  return new Queue<NotificationJobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}
