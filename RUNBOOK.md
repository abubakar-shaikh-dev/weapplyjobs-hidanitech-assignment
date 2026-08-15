# RUNBOOK - WeApplyJobs Backend (Fastify + Prisma + BullMQ)

Runbook for standing up, verifying, and troubleshooting the WeApplyJobs backend locally.

## Architecture at a glance

- **Fastify 5** HTTP server exposing two endpoints:
  - `POST /api/applications` - create an application
  - `GET /health` - connectivity and queue depth
- **Prisma 7 + better-sqlite3** - persistence (SQLite file at `data/applications.db`; migrations in `prisma/migrations`)
- **BullMQ 6 + ioredis** - background jobs:
  - `notifications` - email simulation
  - `stats-updates` - recruiter stats simulation
  - `audit-logs` - audit trail simulation
  - `dead-letter` - collects jobs that failed all retry attempts
- On each application creation, one job is enqueued to each of `notifications`, `stats-updates`, and `audit-logs`. Workers run in-process with the API server.

## Prerequisites

| Requirement | Minimum | Notes                                                                     |
| ----------- | ------- | ------------------------------------------------------------------------- |
| Node.js     | 20+     | Verified on v24. `.nvmrc` pins `24` - run `nvm use` to pick it up         |
| npm         | 10+     | Bundled with Node                                                         |
| Redis       | 7.x     | Any reachable instance; no local install needed if you use a hosted Redis |

## 1. Install dependencies

```sh
npm install
```

## 2. Configure environment

```sh
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```

Edit `.env`:

| Variable       | Example                       | Description                                     |
| -------------- | ----------------------------- | ----------------------------------------------- |
| `DATABASE_URL` | `file:./data/applications.db` | SQLite database path (relative to project root) |
| `REDIS_URL`    | `redis://localhost:6379`      | BullMQ / Redis connection string                |
| `PORT`         | `8000`                        | HTTP listen port                                |
| `BASE_URL`     | `http://localhost:8000`       | Base URL the queue demo uses to reach the API (defaults to the `PORT` example; change it if you change `PORT`) |

> `REDIS_URL` supports the `redis://`, `rediss://`, and `redis+socket://` schemes (e.g. hosted instances such as Aiven Valkey/Redis). It is **required** - the server exits on startup if it is missing.

Optional local Redis via Docker:

```sh
docker run -d --name weapply-redis -p 6379:6379 redis:7
# then set REDIS_URL="redis://localhost:6379"
```

## 3. Apply database migrations

```sh
npx prisma migrate deploy
```

This applies committed migrations to the local SQLite database (`data/applications.db`, which ships with the repo). The schema has a single `applications` table.

> For local iteration you can instead use `npx prisma migrate dev`, which applies **and** creates new migrations.

## 4. Generate the Prisma client

The generated client is gitignored (`src/generated/`), so run this after a fresh clone - and again after any schema change:

```sh
npx prisma generate
```

## 5. Run the server

Development (auto-reload):

```sh
npm run dev
```

Production-style (no watch):

```sh
npm start
```

Expected startup log lines:

```
Redis connected
Queue workers started
Server listening at http://0.0.0.0:8000 || http://127.0.0.1:8000
```

## 6. Verify

### Health check

```sh
curl http://localhost:8000/health
```

Expected `200 OK`:

```json
{
  "status": "ok",
  "db": "connected",
  "redis": "connected",
  "queues": {
    "notifications": { "waiting": 0, "active": 0, "failed": 0 },
    "stats-updates": { "waiting": 0, "active": 0, "failed": 0 },
    "audit-logs": { "waiting": 0, "active": 0, "failed": 0 }
  },
  "uptime": 12
}
```

If `db` or `redis` is `disconnected`, the endpoint returns `503` with `status: "degraded"`.

### Create an application

```sh
curl -s -X POST http://localhost:8000/api/applications \
  -H "content-type: application/json" \
  -d '{"jobId":"job-1","candidateId":"candidate-1","recruiterId":"recruiter-1","coverLetter":"I want this job"}'
```

Expected `201 Created`:

```json
{
  "id": "4f6d5f2a-9b3e-4c1d-8a7b-2e5f0c1d9a3b",
  "jobId": "job-1",
  "candidateId": "candidate-1",
  "recruiterId": "recruiter-1",
  "coverLetter": "I want this job",
  "createdAt": "2026-08-15T11:16:19.354Z"
}
```

### Validation errors

```sh
curl -s -X POST http://localhost:8000/api/applications \
  -H "content-type: application/json" \
  -d '{"jobId":""}'
```

Expected `400 Bad Request` with per-field `details` (all four fields are required and must be non-empty strings).

### Queue processing demo

Fires 20 application creations and polls `/health` every second for 10 seconds to show queues draining (the server must be running; the demo reaches it via `BASE_URL`):

```sh
npm run demo:queue
```

Expected output shows `waiting/active/failed` counts returning to `0/0/0`:

```
fired 20 applications

elapsed  notifications(w/a/f)    stats-updates(w/a/f)    audit-logs(w/a/f)
  0s     20/0/0                  20/0/0                  20/0/0
  ...
 10s     0/0/0                   0/0/0                   0/0/0
```

## 7. Reliability model

- Every job is configured with `attempts: 3` and exponential backoff (`1s` base).
- A job that fails all attempts is moved to the `dead-letter` queue and logged as `[dead-letter]`.
- Retry/failure events are logged to stdout:

```
[notifications] job 1 failed (attempt 1/3): <message> - retrying in 1000ms
[dead-letter] job 3 (application-received-email) from notifications failed after 3 attempts: <message>
```

- The `notifications` worker contains an `intentional-failure` job name that always throws, for exercising the retry + dead-letter path.

## 8. Troubleshooting

| Symptom                                                        | Cause / Fix                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL is not set` or `DATABASE_URL is not set` on startup | `.env` is missing or incomplete. Copy `.env.example` and fill values.                                               |
| `listen EADDRINUSE: address already in use 0.0.0.0:8000`       | Port already taken. Either stop the other process or change `PORT` in `.env`.                                       |
| `/health` returns `503 degraded`                               | Redis or SQLite unreachable - check `REDIS_URL`, the `.env` path, and `data/applications.db` existence.             |
| Jobs stuck in `waiting` forever                                | Worker threads died or Redis lost; restart the server. Check `npm run demo:queue` output.                           |
| `SQLITE_CANTOPEN: unable to open database file`                | `DATABASE_URL` points to a missing/unwritable path. Confirm `data/applications.db` exists (it is committed to the repo) and is writable. |
| Prisma schema/client mismatch                                  | Run `npx prisma migrate deploy` then `npx prisma generate`.                                                         |

## 9. Useful commands

```sh
npm run typecheck   # TypeScript type check (no emit)
npm run build       # Compile to dist/
npm run demo:queue  # Queue drain demo (requires running server on PORT; reaches it via BASE_URL)
```
