export const QUEUE_NAME = "dead-letter";

export interface DeadLetterJobData {
  sourceQueue: string;
  originalJobId?: string;
  originalName: string;
  data: unknown;
  error: { message: string; stack?: string };
  attemptsMade: number;
}
