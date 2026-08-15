# DECISIONS.md

## Prisma 7 with the better-sqlite3 driver adapter, not Prisma's built-in SQLite engine

The stack is Prisma ORM (`prisma` + `@prisma/client`, both v7) with SQLite via the
`@prisma/adapter-better-sqlite3` driver adapter. The datasource is declared without an
embedded engine (`prisma/schema.prisma` defines `provider = "sqlite"` only), and the client is
constructed with the adapter in `src/plugins/db.plugin.ts`:

```ts
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
```

Migrations live in `prisma/migrations` and are applied with `npx prisma migrate deploy`. The
generated client is written to `src/generated/prisma` and is gitignored, so `npx prisma
generate` is required after a fresh clone (see RUNBOOK.md).

## Prisma client created once in a plugin, decorated on Fastify, not per-request

`src/plugins/db.plugin.ts` creates the `PrismaClient` exactly once when the server builds and
exposes it as `fastify.db`. Routes and services (`src/services/applications.service.ts`) use
that shared instance. Creating a client per request would add file-handle and startup
overhead on every call.

## Single `applications` table with UUID id, timestamps, soft delete, and a `jobId` index

`prisma/schema.prisma` models one `Application` (mapped to `applications`):

- `id String @id @default(uuid())` - client-generated UUID, safe if the database is later
  replaced or split, and does not expose record counts through sequential IDs
- `createdAt DateTime @default(now())` - set by the database on insert
- `updatedAt DateTime @updatedAt` - auto-updated by Prisma on every write
- `deletedAt DateTime?` - nullable column for soft deletes (rows are marked, never removed)
- `@@index([jobId])` - index on `jobId` for the common "applications for a job" lookup

## `DATABASE_URL` is a SQLite file URL, resolved at runtime

The adapter reads `DATABASE_URL` from the environment (`file:./data/applications.db` in
`.env.example`, relative to the project root). It is required, with no code default:
`src/config/env.ts` validates it (alongside `REDIS_URL`) at startup and exits with a clear
error if it is missing, so configuration errors surface at boot instead of at first request.

## Zod + fastify-type-provider-zod for request validation

Request bodies are validated with Zod schemas in
`src/validations/applications.validation.ts` (all four fields required, non-empty strings),
wired in via `fastify-type-provider-zod` (`src/plugins/zod.plugin.ts`). A custom error handler
(`src/plugins/error-handler.plugin.ts`) converts validation failures into `400 Bad Request`
with per-field `details`, and serializes the `201` response through the Zod response schema.

## Three BullMQ queues plus one dead-letter queue

Instead of a single queue with a `type` field, each side effect has its own queue
(`notifications`, `stats-updates`, `audit-logs`), each with its own worker
(`src/workers/`). This lets queues be scaled, retried, and monitored independently - a slow
notification consumer cannot block stats or audit jobs. A fourth `dead-letter` queue collects
jobs that exhaust their retries.

On every application creation, one job is enqueued to each of the three queues
(`src/services/queues.service.ts`): `application-received-email`, `recruiter-applications-count`,
and `application-create-audit`.

## Retries: 3 attempts with exponential backoff from 1s

`src/queues/connection.ts` sets the shared default job options:

```ts
attempts: 3,
backoff: { type: "exponential", delay: 1000 },
```

So retries happen at ~1s, 2s, then fail. The `notifications` worker additionally recognizes an
`intentional-failure` job name that always throws, so the retry + dead-letter path can be
exercised on demand.

## Dead-lettering via the worker `failed` event, not BullMQ's failed state

`src/workers/index.ts` wires each worker's `failed` event: on every failure it logs the
attempt (`[notifications] job 1 failed (attempt 1/3): ... — retrying in 1000ms`), and when the
final attempt fails it enqueues a job to the single `dead-letter` queue carrying the source
queue, original job id/name, error, and attempts made (`[dead-letter] job 3
(application-received-email) from notifications failed after 3 attempts: ...`). Job names on
the dead-letter queue are prefixed per source (`dead-letter:notifications`), but it is one
queue, not one queue per workload. The dead-letter queue itself runs with `attempts: 1` so it
never recurses.

## Workers run in-process with the API server

`src/plugins/queue.plugin.ts` creates the queues and all four workers when the server boots
(logs `Queue workers started`) and closes them on shutdown. There is no separate worker
process or `npm run worker` script. This is the simplest correct model for the assignment;
the worker code is structured so it could be split into its own process later without changes
to job/queue definitions.

## `maxRetriesPerRequest: null` everywhere - and its consequence

BullMQ requires `maxRetriesPerRequest: null` on its connections, so both the queue and worker
connections (`src/queues/connection.ts`) use it. The trade-off: when Redis is down,
`queue.add()` does not fail fast - ioredis buffers and retries the command, so the request
hangs rather than returning quickly, and if an enqueue error does surface the error handler
returns `500` (or `503` from `/health`, which reports `redis: "disconnected"`). This is a known
gap; see ANSWERS.md Part 4.5.

## One Redis connection for `@fastify/redis`, separate connections for BullMQ

`src/plugins/redis.plugin.ts` registers `@fastify/redis` (exposed as `fastify.redis`, used by
`/health` for `ping()` and by `createAllQueues` for the `Queue` producers), while each worker
gets its own `Redis` connection from `createRedisConnection()` so worker lifecycle (blocking
commands, close) does not interfere with the producer connection.

## Health endpoint reports connectivity and queue depth

`GET /health` (`src/controllers/health.controller.ts`) pings SQLite (`SELECT 1`) and Redis
(`ping()`), and when Redis is reachable also reports `waiting/active/failed` counts for the
three queues. It returns `200 { status: "ok", ... }` when both are up and `503 {
status: "degraded", ... }` otherwise.

## Redis is required, and enforced at boot

`REDIS_URL` is mandatory: `src/config/env.ts` validates it at startup and exits if it is
missing (the plugins and `createRedisConnection()` read the already-validated value), so the
server never runs with a silently broken queue layer.
