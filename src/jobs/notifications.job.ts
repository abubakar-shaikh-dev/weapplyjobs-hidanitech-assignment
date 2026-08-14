export const QUEUE_NAME = "notifications";

export const INTENTIONAL_FAILURE_JOB_NAME = "intentional-failure";

export interface NotificationJobData {
  type: string;
  recipientId: string;
  subject: string;
  body: string;
}
