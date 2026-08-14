export const QUEUE_NAME = "stats-updates";

export interface StatsUpdateJobData {
  entity: string;
  metric: string;
  value: number;
}
