# ANSWERS.md

## Part 1 - Diagnose a production incident

### 1. Reconstruct 14:31:58 → 14:32:09

**14:31:58–14:32:00** - `connections=45 → 48 → 51`. This field is too large to be any single
instance's Prisma pool (`pool_size=10`, confirmed by the WARN line a second later), so it has
to be the total connection count on the MySQL server itself - i.e. the sum across every warm
Next.js serverless instance currently holding connections. It's climbing by ~3/sec, which
means write traffic is bursting and either more instances are spinning up to absorb it, or the
existing instances are opening more of their own pooled connections as concurrent requests
land on them.

**14:32:01** - `PrismaClientInitializationError: connection pool timeout, pool_timeout=10s
pool_size=10 queued=23 active=10`. One specific instance's own pool is completely saturated:
all 10 of its connections are `active`, and 23 more requests on that *same instance* are
sitting in Prisma's internal wait queue for a free connection. After `pool_timeout=10s` with no
connection freed up, Prisma gives up and throws instead of waiting forever.

**14:32:01–14:32:02** - `ERROR POST /api/applications 500 10043ms` and `500 10041ms`. The
timing is the tell: ~10043ms and ~10041ms are `pool_timeout` (10,000ms) plus a few
milliseconds of overhead. These are two of the 23 queued requests finally timing out and
surfacing as 500s to the client - not a new failure mode, the same saturation event finishing
its timeout clock.

**14:32:02** - `MySQL: Too many connections (max_connections=151)`. While one instance is
queuing internally, the *aggregate* connection count across all instances (which was at 51 and
climbing) has now hit MySQL's hard ceiling of 151. MySQL starts refusing brand-new connection
attempts from any instance - including instances that were trying to scale up to absorb the
burst, which makes the pile-up worse, not better.

**14:32:08** - `INFO POST /api/applications 200 4821ms connections=34`. Connections have
dropped from 51+ down to 34. Two things released capacity at once: the queued requests that
timed out gave up their spot in the wait queue, and their now-abandoned TCP connections got
torn down, handing physical connections back to MySQL; and whatever caused the write burst
(a wave of recruiters submitting around the same time) started tapering off. The request
succeeds, but at 4821ms - 16x the normal ~290ms - the system is still draining backlog, not
back to steady state.

**14:32:09** - `200 4834ms connections=31`. Still recovering (still slow, still elevated), but
no more errors. The self-healing continues without intervention because pool timeouts are, by
construction, a self-limiting failure mode: every stuck request eventually times out and frees
its resources, whether or not a human does anything.

### 2. What `pool_size=10` and `queued=23` together tell you about instance count

Two separate inferences here, and they answer two different questions.

**First: this rules out strict one-request-per-container Lambda semantics.** `active=10` and
`queued=23` are both scoped to a *single* Prisma Client - a single serverless instance is
fielding at least 33 concurrent database-touching requests at once (10 being served, 23
waiting). That's only possible if this platform runs a persistent Node.js process per instance
that fans out to handle many concurrent HTTP requests over the event loop, sharing one Prisma
Client and its pool - not classic AWS Lambda, where each concurrent request gets its own fresh
container and therefore its own fresh (idle) pool.

**Second: estimating the instance count.** We know total MySQL connections were around 51 at
roughly this moment (14:31:59–14:32:00), and we know each instance's pool is capped at
`pool_size=10`. If most warm instances are near-saturated (a reasonable assumption during a
burst severe enough to trigger pool timeouts), then instance count ≈ 51 ÷ 10 ≈ 5 instances,
maybe a 6th partially warmed. This shows the problem: five or six instances,
each independently allowed up to 10 connections, is already consuming a third of MySQL's
151-connection ceiling - and this one instance alone *wants* to serve 33 concurrent requests
against a budget of 10. The math doesn't work at 200 recruiters, let alone 1,000.

### 3. Why it recovered on its own at 14:32:08

No one intervened because queued requests eventually timed out after 10 seconds. This freed
resources and reduced MySQL connections from 51 to 34 to 31. The traffic burst also slowed down,
so the system recovered by itself, although requests were still slow.

### 4. Slack message: why `connection_limit=100` makes it worse

> Hey - thanks for digging into this, but I don't think bumping `connection_limit` to 100 is
> going to fix it, and I think it'll actually make the collapse worse, not better.
>
> The main point is: `connection_limit` in the Prisma URL sets how many DB connections **each
> running copy of our app** is allowed to open - it's not a total budget shared across
> everything, it's a per-instance allowance. Right now we've got roughly 5–6 of these instances
> warm at once during a busy stretch, each capped at 10 connections, and that's already enough
> to push MySQL close to its hard limit of 151 total connections.
>
> If we raise that cap to 100 per instance, then just *two* instances running at the same time
> could try to open 200 connections between them - more than MySQL allows, period. Instead of
> an occasional 30–90 second hiccup once traffic gets heavy, we'd risk "too many connections"
> becoming the normal state any time we have a couple of instances warm together, which during
> our peak recruiter hours is basically always.
>
> The real fix has to reduce the *total* number of connections hitting MySQL at once - either
> by pooling connections through something like RDS Proxy or Prisma Accelerate (which sits
> between our app and MySQL and shares a small set of real connections across every instance),
> or by cutting down how many separate instances are opening their own pools in the first
> place. Happy to pair on this if it'd help - the pooling piece is a well-understood fix, we
> just need to point our setup at it.

### 5. What Prisma Accelerate is doing, why it helps, and its limits at 1,000 recruiters

**What it does:** Accelerate sits between Prisma and MySQL. App instances connect to
Accelerate, while Accelerate maintains a smaller pool of real MySQL connections.

**Why it helps:** all app instances share that backend pool, so adding instances does not
directly increase MySQL connections.

**Its limits at 1,000 concurrent recruiters:**
- It's a connection-count fix, not a throughput fix. Recruiters are write-heavy, and writes
  generally bypass Accelerate's cache - the underlying RDS instance's actual write capacity
  (CPU, IOPS) is still the real ceiling, and Accelerate doesn't raise it.
- It adds a network hop. Every query now goes through Accelerate's edge infrastructure before
  reaching MySQL - extra latency that matters more on a write-heavy, latency-sensitive
  synchronous path like recruiter submissions.
- Accelerate's own backend pool to MySQL is still finite and still bounded by what MySQL can
  actually handle - at high enough aggregate volume from 1,000 recruiters, you'd see queuing
  *inside* Accelerate instead of visible `pool_timeout` errors. Same ceiling, just moved and
  partly hidden from our own logs.
- It's another hop and another vendor dependency in the critical path - if Accelerate degrades
  or has an outage, every DB-touching request is affected.

It is a useful short-term fix for the exact incident we just diagnosed, but it doesn't
replace the roadmap in Part 2 - read replicas, workload separation, and getting synchronous
side effects off the request path all still need to happen to actually hit 1,000 recruiters.

---

## Part 2 - Architectural design

### 1. Six-month roadmap

1. **Move all synchronous side effects off the request path** (email, WhatsApp, stats update,
   audit log) into a background queue, keeping a single app and single DB. *Why first:* it's
   the cheapest, lowest-risk change available, and it directly shrinks the blast radius of
   today's incident - a ~800ms email send holding a DB connection open is exactly the kind of
   thing that turns a normal traffic bump into a pool-exhaustion event. *Measure:* p95/p99
   latency on `POST /api/applications` should drop from 800ms+ to well under 100ms, and pool
   timeouts during peak hours should disappear entirely.

2. **Put a real connection pooler in front of MySQL** - RDS Proxy or Prisma Accelerate, sized
   deliberately using the formula from Part 4.1, rather than each instance opening its own raw
   pool. *Why before scaling further:* this is the actual fix for the root cause of the
   incident we just diagnosed, and every later step adds more traffic - we shouldn't build on
   top of infrastructure that already breaks under moderate load. *Measure:* MySQL's total
   connection count stays well under 151 through a full week of real peak traffic, with zero
   `pool_timeout` errors.

3. **Add a read replica; route user-facing reads to it, keep recruiter writes on the primary.**
   *Why now:* users are 100x the scale of recruiters and read-heavy - this is the single
   highest-leverage change to protect write capacity for recruiters before user traffic ramps
   up. *Measure:* replica lag stays low (sub-2s) under load, primary's read query volume drops
   sharply, and write latency on the primary improves or holds steady even as read traffic
   grows.

4. **Add caching (Redis) for the highest-traffic read paths - job listings specifically -**
   with active invalidation, not just TTL (see Part 2.5). *Why not earlier:* caching on top of
   an unstable DB foundation just hides problems temporarily; doing it after steps 1–3 means
   we're optimizing a system that's already solid. *Measure:* cache hit rate on listing
   endpoints, reduced replica load, reduced average listing response time.

5. **Split recruiter-facing and user-facing API routes into separately deployed/scaled targets**
   sharing the same database - not full microservices yet, just independent deployment and
   independent pool/rate-limit budgets per workload. *Why now:* by this point traffic has grown
   enough that write bursts from recruiters and read bursts from users can genuinely compete for
   the same resource budget; separating lets us tune each independently. *Measure:* recruiter
   write latency stays stable regardless of user read traffic spikes, and vice versa.

6. **Formalize the split into fully separate backend services if step 5 proved out the value,**
   and only then evaluate whether the DB itself needs to change (bigger instance class, Aurora
   Serverless v2, or - only if genuinely necessary - sharding). *Why last:* this is the most
   expensive step on the list; it should be justified by real measured data from steps 1–5, not
   taken on faith upfront. *Measure:* the system holds 1,000 concurrent recruiters and 100,000
   active users in load testing without the failure mode from Part 1 recurring.

### 2. Split recruiter and user workloads into separate services, or keep together?

**Keep them together:** both workloads use the same core data. One codebase is simpler for a
small team. Separate deployment targets can provide much of the scaling benefit without full
microservices.

**Split them:** recruiters are write-heavy and latency-sensitive. Users are read-heavy at
about 100x the recruiter scale. Sharing the same resources means a user traffic spike can hurt
recruiter writes. Separate deployments isolate these workloads.

**Recommendation:** split, but incrementally, and not into fully separate services with
separate repos and separate databases from day one. Step 5 in the roadmap above - separate
deployment targets sharing one database - captures most of the reliability and scaling benefit
of a full split at a fraction of the operational cost. The core signal here (very different
scale profiles, very different latency sensitivity, a real incident already caused by them
sharing a resource budget) is strong enough to justify *some* separation. But the underlying
data is still one coherent domain, and a full microservice split with independent data stores
is a lot of complexity to take on before there's evidence the lighter-weight split isn't enough.

### 3. Response to a horizontal-sharding proposal in a technical meeting

> I'd push back on sharding as the first move here. Sharding solves a specific problem - a
> single database that's genuinely out of write or storage capacity after everything else has
> been optimized - and we haven't gotten there yet. It's also one of the most expensive things
> we could take on: we'd need to pick a shard key up front that's painful to change later,
> rewrite any query that currently joins across recruiters, jobs, and applications to either
> avoid cross-shard joins or accept eventual consistency, build and maintain shard-routing logic
> in the app, and multiply our operational burden for backups and migrations.
>
> Before taking on that cost, we haven't exhausted much cheaper options. Today's incident was a
> connection-pooling misconfiguration, not a database capacity problem - MySQL itself wasn't
> CPU- or IO-bound, it just had too many idle, queued connections. We haven't added a read
> replica yet, and reads are going to be our largest source of volume once the 100k users are
> onboarded - offloading those alone probably buys most of the headroom we need. We haven't
> vertically scaled the RDS instance, which for MySQL is usually the single highest-leverage
> lever available with zero code changes. And we haven't separated the recruiter and user
> workloads, which would protect write capacity specifically for recruiters.
>
> What I'd try first, in order: fix the connection pooling issue we already scoped, add a read
> replica for user-facing reads, and then load-test at our actual 1,000-recruiter /
> 100,000-user targets to see where the real bottleneck shows up - connections, CPU, IOPS, or
> something else. If we're still write-bound on a single, properly-tuned, appropriately-sized
> primary after all of that, sharding becomes the right conversation. I'd rather make that call
> with real numbers than commit to a multi-quarter migration on a guess.

### 4. What must stay synchronous in "submit job application"

Only the application row insert has to stay synchronous. It's the one outcome the candidate is
actually waiting on - they need immediate confirmation that their application was recorded -
and it's a single fast, indexed insert (this is exactly what Part 3's route does, targeting
under 100ms).

Everything else - the confirmation email (~800ms), the recruiter-stats update, the audit log,
and the WhatsApp message - should be queued immediately after the insert succeeds and processed
asynchronously, using the same pattern built in Part 3: BullMQ (or SQS + workers) with Redis,
one queue per side-effect type so a slow or flaky consumer (WhatsApp's API, for instance)
doesn't delay or block unrelated work like the audit log. Each queue gets retries with backoff
and a dead-letter queue for anything that exhausts its retries, so "async" doesn't mean "allowed
to silently disappear."

The audit log is worth calling out specifically, since it can feel like something that must
never be delayed. It doesn't need to be synchronous - a few seconds of delay in an audit trail
is fine. What actually matters is that it's never silently dropped, which retries + a
dead-letter queue already guarantee. Coupling it to the candidate-facing request would tie their
latency to an internal bookkeeping write, which is the wrong trade-off.

### 5. Three ways a candidate sees stale job-listing data, and how to prevent each

**1. Plain TTL staleness.** The candidate's request is served from a cache entry written before
the recruiter closed the job, and the 5-minute TTL simply hasn't expired yet. *Prevention:*
actively invalidate (delete or overwrite) that job's specific cache key as part of the close
operation itself, rather than relying on TTL expiry to be the only mechanism. TTL becomes a
safety net for cases the active invalidation misses, not the primary defense.

**2. Stale collection/list caching.** The cached entity isn't the individual job - it's a list
("all open jobs in category X") that includes this job among others. Invalidating the single
job's own cache key does nothing here, because the stale list key still has the job embedded in
it. *Prevention:* this needs either a cache-tagging scheme (tag every cached list with the job
IDs it contains, and bust by tag when any of those jobs changes) or, more simply, much shorter
TTLs specifically for list/collection views while individual job-detail pages keep the longer
TTL.

**3. In-flight race at the moment of closing.** A candidate's request was already served -
already in their browser, already rendered - at the exact instant the recruiter closes the job.
No cache-invalidation strategy prevents this, because it's not a caching problem: the client
already has data that's now out of date, and no amount of server-side cache correctness changes
what's already in their hands. *Prevention:* the actual submission endpoint
(`POST /api/applications`) has to do a final authoritative check against live, non-cached
database state before accepting the application, and reject with a clear message if the job has
since closed - regardless of what the listing page showed a moment earlier.

---

## Part 4 - Capacity planning

### 1. Determining the right connection pool size

Note on this implementation specifically: Part 3 actually uses `better-sqlite3`, which is
synchronous and single-connection by nature (SQLite doesn't support genuinely concurrent
writers, so a traditional async pool isn't the right model for it). The question below is
answered for the general case this scenario clearly intends: a pooled async client against a
real multi-writer database like MySQL or Postgres.

**Variables needed:**
- Target throughput - requests per second that will actually touch the database.
- Average connection hold time - how long a typical query/transaction keeps a connection
  checked out.
- Number of concurrent application instances that will each run their own pool (since
  `connection_limit`/pool size in most drivers, including Prisma, is a *per-instance* setting -
  see Part 1.4).
- The database's actual hard connection ceiling (`max_connections`), minus headroom reserved
  for migrations, admin tooling, monitoring, and replication threads.

**Formula:** the standard starting point is Little's Law - the average number of connections
needed concurrently equals arrival rate times average hold time:

```
pool_size ≈ throughput (requests/sec) × avg_connection_hold_time (sec)
```

That gives the *average* concurrent demand, not the peak - real traffic is bursty, so add
headroom (commonly 20–50%) on top of the Little's Law number to absorb bursts above average
without queuing. Then multiply the resulting per-instance pool size by the number of concurrent
application instances, and check that total against the database's actual `max_connections`
(minus reserved headroom). If per-instance pool × instance count exceeds what the database can
actually take, the fix is a shared pooler (RDS Proxy, PgBouncer, Accelerate) or fewer/larger
instances - not simply raising each instance's own limit, which is exactly the mistake in Part
1.4.

### 2. Minimum pool size for 1,000 recruiters at 12 writes/min, 40ms/write

Working, using Little's Law:

```
Arrival rate (λ):  1,000 recruiters × 12 writes/min = 12,000 writes/min
                    12,000 ÷ 60 = 200 writes/sec

Hold time (W):      40ms = 0.04 sec

L = λ × W = 200 × 0.04 = 8
```

**Minimum pool size ≈ 8 connections**, under the stated assumptions.

8 connections is the theoretical minimum. Real traffic is bursty, so 15-20 is a better
starting point. Tune it using observed p95 queue time.

### 3. `stats-updates` worker falling behind - three fixes and trade-offs

1. **Increase worker concurrency** (raise `concurrency`, or run more worker processes).
   *Trade-off:* more simultaneous DB writes from the stats-update jobs, which can reintroduce
   the exact connection-pressure problem from Part 1 if the pool isn't sized for it; and if the
   stats update isn't an atomic operation (e.g. read-then-increment-then-write instead of a
   single `UPDATE ... SET count = count + 1`), higher concurrency risks lost updates from race
   conditions.

2. **Batch the work.** Instead of one job = one DB write, accumulate updates over a short
   window (or pull several jobs at once) and apply them in a single batched write.
   *Trade-off:* stats become "eventually updated within the batch window" instead of updated
   immediately, and partial-batch failures need explicit handling - do you retry the whole
   batch, or just the item that failed?

3. **Reduce the cost per job.** Profile what's actually slow in the processor - a missing
   index, an unnecessary read-before-write, an avoidable external call - and fix it directly;
   or change the data model so updates are cheap atomic increments rather than full
   read-modify-write cycles (e.g. a dedicated counters table, or counting in Redis and
   periodically syncing to the primary DB). *Trade-off:* this is real engineering investigation
   time, not a config change, and a data-model change touches more of the system than the other
   two options.

### 4. Read replica with 2s lag - read-your-own-writes problem

**What they see:** if the "refresh my application list" read is routed to the replica (as the
Part 2 roadmap proposes for read-heavy traffic), and the replica is 2 seconds behind the
primary, the recruiter's just-submitted application almost certainly won't appear yet - the
replica hasn't replayed that write. This is the standard read-your-own-writes consistency gap
in any primary/replica setup, not a bug in the replica itself.

**How to prevent it without removing the replica:**
- **Optimistic UI, first choice for this exact scenario:** the `POST /api/applications`
  response already returns the full created application object (as built in Part 3) - the
  frontend can show that object directly in the list immediately, without needing to re-query
  anything. This sidesteps the lag problem entirely for the one case that matters most: a user
  seeing their own just-submitted write.
- **Short-window primary routing for the user's own reads:** for a few seconds after a user's
  own write, route *that user's* subsequent reads to the primary instead of the replica (via a
  session flag or cookie), falling back to the replica once the window passes.
- **Consistency-token routing** (more complex, for cases optimistic UI can't cover): track the
  binlog/GTID position of the user's write and only serve their next read from a replica that's
  confirmed caught up to at least that position, waiting briefly or falling back to primary
  otherwise.

For this specific "recruiter refreshes their own list" scenario, optimistic UI plus short-window
primary routing solves it with far less complexity than building general consistency tokens.

### 5. The single biggest architectural risk in the Part 3 implementation

**The dual-write gap between the DB insert and the queue enqueue.** The route inserts the
application row into SQLite, then enqueues three BullMQ jobs against Redis
(`enqueueApplicationCreatedJobs` in `src/services/queues.service.ts`, called after
`createApplication` in `src/controllers/applications.controller.ts`). Those are two separate
systems with no shared transaction between them. The connections are configured with
`maxRetriesPerRequest: null` (`src/queues/connection.ts`), so if Redis is unreachable during
the enqueue step, the `queue.add()` calls don't fail fast - they buffer and keep retrying
indefinitely, which means the request hangs until Redis comes back (or until a proxy/load
balancer gives up). If an enqueue error does surface, the error handler in
`src/plugins/error-handler.plugin.ts` maps it to a generic `500` - not a clean `503`, and
definitely not a response that tells the client the application was already saved.

And none of that covers the worst case: the process crashing (or the container being killed)
in the narrow window after the DB insert commits but before the three `queue.add()` calls
finish. In that window, an application would be saved with no notification, stats update, or
audit log ever queued - and nothing in the current design would ever detect or retry that gap.
It's the same class of problem the incident diagnosis and Part 2.4 both point at: side effects
that depend on two independent systems staying in sync without a shared source of truth.

**What I'd do with another day:** implement the transactional outbox pattern. Write the
application row and a corresponding "pending side effects" row into the *same* local SQLite
transaction - so the DB write and the record of "these three jobs need to be enqueued" become
atomic together, since they're both just local writes to the same database. A separate,
lightweight poller then reads unprocessed outbox rows, enqueues the corresponding BullMQ jobs,
and marks them dispatched once the enqueue actually succeeds. That closes the gap completely:
either both the application and its outbox row commit together, or neither does - there's no
window where one exists without the other. The cost is a small amount of added latency (the
poller's cycle time before jobs actually get enqueued) and one more moving piece to operate.

A smaller, related risk worth a one-line mention: the three `queue.add()` calls in
`Promise.all` aren't independently idempotent-safe on a client retry - if two of the three
succeed and the third fails, a client retry (e.g. after a request timeout or connection drop)
could enqueue duplicate jobs for the two that already succeeded. The outbox pattern above
would also fix this, since dispatch would be driven by the outbox row's state rather than
re-running all three calls blind.
