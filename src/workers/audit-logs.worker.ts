import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { QUEUE_NAME, type AuditLogJobData } from "../jobs/audit-logs.job.js";

export async function processAuditLogJob(job: Job<AuditLogJobData>): Promise<void> {
  console.log(`[audit-logs] processing job ${job.id}:`, job.data);
}

export function createAuditLogsWorker(connection: ConnectionOptions): Worker<AuditLogJobData> {
  return new Worker<AuditLogJobData>(QUEUE_NAME, processAuditLogJob, { connection });
}
