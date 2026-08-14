import { Queue, type ConnectionOptions } from "bullmq";
import { QUEUE_NAME, type DeadLetterJobData } from "../jobs/dead-letter.job.js";

export function createDeadLetterQueue(connection: ConnectionOptions): Queue<DeadLetterJobData> {
  return new Queue<DeadLetterJobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: { attempts: 1 },
  });
}
