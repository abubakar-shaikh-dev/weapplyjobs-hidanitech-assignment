import { env } from "../src/config/env.js";

const BASE_URL = env.BASE_URL;
const REQUESTS = 20;
const DURATION_SECONDS = 10;
const POLL_INTERVAL_MS = 1000;
const COLUMN_WIDTH = 24;

interface QueueCounts {
  waiting: number;
  active: number;
  failed: number;
}

function formatCounts(counts: QueueCounts | undefined): string {
  if (!counts) {
    return "-/-/-";
  }
  return `${counts.waiting}/${counts.active}/${counts.failed}`;
}

async function fireApplications(): Promise<void> {
  const body = JSON.stringify({
    jobId: "job-1",
    candidateId: "candidate-1",
    recruiterId: "recruiter-1",
    coverLetter: "I want this job",
  });

  await Promise.allSettled(
    Array.from({ length: REQUESTS }, () =>
      fetch(`${BASE_URL}/api/applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    ),
  );

  console.log(`fired ${REQUESTS} applications`);
}

async function pollHealth(): Promise<void> {
  console.log(
    `elapsed  ${"notifications(w/a/f)".padEnd(COLUMN_WIDTH)}${"stats-updates(w/a/f)".padEnd(COLUMN_WIDTH)}audit-logs(w/a/f)`,
  );

  const startedAt = Date.now();

  while (true) {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);

    let queues: Record<string, QueueCounts> = {};
    try {
      const response = await fetch(`${BASE_URL}/health`);
      queues = (await response.json()).queues as Record<string, QueueCounts>;
    } catch (error) {
      console.error(`[demo] /health poll failed: ${(error as Error).message}`);
    }

    console.log(
      `${String(elapsed).padStart(3)}s     ` +
        `${formatCounts(queues?.notifications).padEnd(COLUMN_WIDTH)}` +
        `${formatCounts(queues?.["stats-updates"]).padEnd(COLUMN_WIDTH)}` +
        formatCounts(queues?.["audit-logs"]),
    );

    if (elapsed >= DURATION_SECONDS) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

await fireApplications();
await pollHealth();
