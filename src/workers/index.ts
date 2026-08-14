import { Queue, Worker, type BackoffOptions } from "bullmq";
import { createRedisConnection } from "../queues/connection.js";
import { QUEUE_NAME as AUDIT_LOGS_QUEUE_NAME, type AuditLogJobData } from "../jobs/audit-logs.job.js";
import type { DeadLetterJobData } from "../jobs/dead-letter.job.js";
import { QUEUE_NAME as NOTIFICATIONS_QUEUE_NAME, type NotificationJobData } from "../jobs/notifications.job.js";
import { QUEUE_NAME as STATS_UPDATES_QUEUE_NAME, type StatsUpdateJobData } from "../jobs/stats-updates.job.js";
import { createAuditLogsWorker } from "./audit-logs.worker.js";
import { createDeadLetterWorker } from "./dead-letter.worker.js";
import { createNotificationsWorker } from "./notifications.worker.js";
import { createStatsUpdatesWorker } from "./stats-updates.worker.js";

export interface Workers {
  notificationsWorker: Worker<NotificationJobData>;
  statsUpdatesWorker: Worker<StatsUpdateJobData>;
  auditLogsWorker: Worker<AuditLogJobData>;
  deadLetterWorker: Worker<DeadLetterJobData>;
  close: () => Promise<void>;
}

function retryDelayMs(
  backoff: number | BackoffOptions | undefined,
  attemptsMade: number,
): number | null {
  if (!backoff) {
    return null;
  }
  if (typeof backoff === "number") {
    return backoff;
  }
  if (backoff.type === "exponential") {
    return (backoff.delay ?? 0) * 2 ** (attemptsMade - 1);
  }
  if (backoff.type === "fixed") {
    return backoff.delay ?? 0;
  }
  return null;
}

function wireFailureHandling<Data>(
  worker: Worker<Data>,
  label: string,
  deadLetterQueue: Queue<DeadLetterJobData>,
): void {
  worker.on("failed", (job, error) => {
    if (!job) {
      return;
    }

    const attempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade >= attempts;
    const delay = retryDelayMs(job.opts.backoff, job.attemptsMade);
    const retrying = !isFinalAttempt && delay !== null;
    const suffix = retrying ? ` — retrying in ${delay}ms` : "";

    console.log(
      `[${label}] job ${job.id} failed (attempt ${job.attemptsMade}/${attempts}): ${error.message}${suffix}`,
    );

    if (isFinalAttempt) {
      deadLetterQueue
        .add(`dead-letter:${label}`, {
          sourceQueue: label,
          originalJobId: job.id,
          originalName: job.name,
          data: job.data,
          error: { message: error.message, stack: error.stack },
          attemptsMade: job.attemptsMade,
        })
        .catch((err) =>
          console.error(`[dead-letter] failed to enqueue from ${label}:`, err),
        );
    }
  });
}

export function createAllWorkers(deadLetterQueue: Queue<DeadLetterJobData>): Workers {
  const notificationsConnection = createRedisConnection();
  const statsUpdatesConnection = createRedisConnection();
  const auditLogsConnection = createRedisConnection();
  const deadLetterConnection = createRedisConnection();

  const notificationsWorker = createNotificationsWorker(notificationsConnection);
  const statsUpdatesWorker = createStatsUpdatesWorker(statsUpdatesConnection);
  const auditLogsWorker = createAuditLogsWorker(auditLogsConnection);
  const deadLetterWorker = createDeadLetterWorker(deadLetterConnection);

  wireFailureHandling(notificationsWorker, NOTIFICATIONS_QUEUE_NAME, deadLetterQueue);
  wireFailureHandling(statsUpdatesWorker, STATS_UPDATES_QUEUE_NAME, deadLetterQueue);
  wireFailureHandling(auditLogsWorker, AUDIT_LOGS_QUEUE_NAME, deadLetterQueue);

  return {
    notificationsWorker,
    statsUpdatesWorker,
    auditLogsWorker,
    deadLetterWorker,
    close: async () => {
      await Promise.all([
        notificationsWorker.close(),
        statsUpdatesWorker.close(),
        auditLogsWorker.close(),
        deadLetterWorker.close(),
      ]);
      notificationsConnection.disconnect();
      statsUpdatesConnection.disconnect();
      auditLogsConnection.disconnect();
      deadLetterConnection.disconnect();
    },
  };
}
