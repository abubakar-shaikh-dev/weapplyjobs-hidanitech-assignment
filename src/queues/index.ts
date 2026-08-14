import { Queue, type ConnectionOptions } from "bullmq";
import { createAuditLogsQueue } from "./audit-logs.queue.js";
import { createDeadLetterQueue } from "./dead-letter.queue.js";
import { createNotificationsQueue } from "./notifications.queue.js";
import { createStatsUpdatesQueue } from "./stats-updates.queue.js";
import type { AuditLogJobData } from "../jobs/audit-logs.job.js";
import type { DeadLetterJobData } from "../jobs/dead-letter.job.js";
import type { NotificationJobData } from "../jobs/notifications.job.js";
import type { StatsUpdateJobData } from "../jobs/stats-updates.job.js";

export interface Queues {
  notifications: Queue<NotificationJobData>;
  statsUpdates: Queue<StatsUpdateJobData>;
  auditLogs: Queue<AuditLogJobData>;
  deadLetter: Queue<DeadLetterJobData>;
}

export function createAllQueues(connection: ConnectionOptions): Queues {
  return {
    notifications: createNotificationsQueue(connection),
    statsUpdates: createStatsUpdatesQueue(connection),
    auditLogs: createAuditLogsQueue(connection),
    deadLetter: createDeadLetterQueue(connection),
  };
}
