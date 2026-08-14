import { Queue, type ConnectionOptions } from "bullmq";
import { DEFAULT_JOB_OPTIONS } from "./connection.js";
import { QUEUE_NAME, type AuditLogJobData } from "../jobs/audit-logs.job.js";

export function createAuditLogsQueue(connection: ConnectionOptions): Queue<AuditLogJobData> {
  return new Queue<AuditLogJobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}
