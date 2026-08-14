import type { Queues } from "../queues/index.js";
import type { ApplicationRecord } from "./applications.service.js";

export async function enqueueApplicationCreatedJobs(
  queues: Queues,
  application: ApplicationRecord,
): Promise<void> {
  await Promise.all([
    queues.notifications.add("application-received-email", {
      type: "email",
      recipientId: application.candidateId,
      subject: "Application received",
      body: `Your application for job ${application.jobId} has been received.`,
    }),
    queues.statsUpdates.add("recruiter-applications-count", {
      entity: "recruiter",
      metric: "applications_count",
      value: 1,
    }),
    queues.auditLogs.add("application-create-audit", {
      actorId: application.candidateId,
      action: "application.create",
      resource: `application:${application.id}`,
      metadata: {
        jobId: application.jobId,
        recruiterId: application.recruiterId,
      },
    }),
  ]);
}
