# JobFlow — Design Decisions

## 1. Atomic Job Claiming: SELECT FOR UPDATE SKIP LOCKED

**Decision**: Use raw PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED` for job claiming.

**Alternatives considered**:
- Redis-based queue (BullMQ, Kue): Adds Redis as a required single-point-of-failure for job durability. Loses ACID guarantees.
- Optimistic locking (compare-and-swap on status): Leads to retry storms under high contention.
- Database-level advisory locks: Complex to manage at scale.

**Why SKIP LOCKED**:
- Atomically claims exactly one job per worker per poll
- Automatically skips jobs locked by other workers — no retry needed
- Zero coordination overhead between workers
- Jobs remain in PostgreSQL — durable by default, queryable with SQL

**Trade-off**: PostgreSQL becomes the job broker. At very high throughput (>10k jobs/sec), consider Redis as a fast lane with PostgreSQL as durable storage.

---

## 2. Separate Worker and Scheduler Processes

**Decision**: Worker (execution) and Scheduler (cron) are separate processes.

**Why**:
- A slow cron scan doesn't block job execution
- Scheduler can be a single instance (using distributed lock), while workers can scale horizontally
- Clear separation of concerns; each can be scaled independently

---

## 3. Retry with Jitter

**Decision**: All retry delays have ±10% random jitter applied.

**Why**:
- Prevents the "thundering herd" problem where all failed jobs retry simultaneously
- Especially important for EXPONENTIAL strategy where many jobs fail at similar times (e.g., downstream service outage)

---

## 4. Dead Letter Queue Design

**Decision**: DLQ is a first-class table with requeue/resolve workflows.

**Why**:
- Permanently failed jobs should not be silently dropped
- Operators need visibility into what failed, why, and how many times
- One-click requeue from dashboard enables fast recovery
- `ai_summary` field reserved for future AI-generated failure analysis

---

## 5. Redis: Optional but Recommended

**Decision**: Redis is used for distributed locking and pub/sub, but the system degrades gracefully without it.

**Fallback behavior**:
- Without Redis: rate limiting disabled, WebSocket events broadcast directly (single-instance only), cron lock not enforced (duplicate scheduling risk in multi-scheduler setup)
- With Redis: full distributed capabilities

**Why not make Redis mandatory**: Reduces barrier to development setup; teams can get started with just PostgreSQL.

---

## 6. JWT + API Keys

**Decision**: Dashboard uses JWT; programmatic access uses project-scoped API keys.

**Why**:
- JWT is stateless — no session store needed, scales horizontally
- API keys are bcrypt-hashed in DB (same as passwords) — even a DB breach doesn't expose keys
- Raw API key shown exactly once on creation (GitHub-style)
- Keys are project-scoped — compromised key is isolated

---

## 7. Cron as Template Jobs

**Decision**: A cron job is stored as a "template" job + a `scheduled_jobs` row. Each trigger creates a new `Job` row.

**Why**:
- Full execution history for every cron trigger
- Each run can be individually retried, inspected, and logged
- Cron schedule changes don't affect in-flight runs
- Template job holds the base payload and configuration

**Trade-off**: More rows in the `jobs` table over time. Mitigate with archival/TTL strategy for completed jobs.

---

## 8. Idempotency Keys

**Decision**: Optional per-queue idempotency keys with unique constraint.

**Use case**: Client submits job, network fails, client retries. Without idempotency key, job runs twice. With key, second submission is rejected with 409 Conflict.

**Implementation**: Unique index on `(queue_id, idempotency_key)` at database level — zero application-layer complexity.

---

## 9. Heartbeat-based Worker Health

**Decision**: Workers are marked OFFLINE if no heartbeat in 30 seconds.

**Why**:
- Workers don't need to explicitly deregister on crash
- API automatically detects stale workers on list queries
- Failed workers' in-flight jobs can be detected and re-queued (future: auto-recovery by checking `CLAIMED/RUNNING` jobs with no recent heartbeat from that worker)

---

## 10. Horizontal Scaling

**Design for**:

| Component | Scaling Strategy |
|---|---|
| API Server | Stateless → scale with load balancer |
| Workers | Horizontal → SKIP LOCKED prevents conflicts |
| Scheduler | Single active instance → Redis distributed lock |
| PostgreSQL | Vertical → read replicas for metrics queries |
| Redis | Single node → Redis Sentinel/Cluster for HA |

---

## Known Limitations & Future Work

1. **Job cancellation of running jobs**: Currently, RUNNING jobs cannot be force-stopped. Would require worker-level polling for cancel signals or process.kill with timeout.
2. **Job output size**: JSONB result stored in job_executions — large outputs should be offloaded to object storage (S3).
3. **Log retention**: job_logs can grow unbounded. Should implement partition pruning or TTL-based deletion.
4. **Workflow DAG**: Current implementation stores dependencies but doesn't yet enforce them at dispatch time (a job with unsatisfied dependencies will still be picked up). Full DAG executor is a future feature.
