export const QUEUE_NAME = "audit-logs";

export interface AuditLogJobData {
  actorId: string;
  action: string;
  resource: string;
  metadata?: Record<string, unknown>;
}
