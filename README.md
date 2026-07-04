# JobFlow

A distributed job scheduling platform built for reliability and observability. Multi-tenant architecture with atomic job execution across horizontally scalable workers, configurable retry policies, a live monitoring dashboard, and WebSocket-driven real-time updates.

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

---

## Overview

JobFlow provides a complete backend infrastructure for running asynchronous background jobs at scale. It solves the classic distributed systems problems — preventing double execution, handling partial failures, managing retries, and surfacing system health — through a clean REST API and a real-time web dashboard.

The platform is designed around three principles:

- **Reliability** — Jobs are never lost or executed twice, even across worker crashes or network failures.
- **Scalability** — Workers scale horizontally with no coordination overhead. PostgreSQL's `SKIP LOCKED` clause handles contention atomically.
- **Observability** — Every job, execution attempt, log line, and worker heartbeat is recorded and queryable.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  React Dashboard                │
│   Auth  Queues  Jobs  Workers  Metrics  DLQ     │
└────────────────────┬────────────────────────────┘
                     │  HTTP REST + WebSocket
┌────────────────────▼────────────────────────────┐
│              Fastify API Server                 │
│  /auth  /projects  /queues  /jobs               │
│  /workers  /metrics  /dlq  /ws                  │
└──────┬────────────────────────────┬─────────────┘
       │                            │
  ┌────▼────┐                ┌──────▼──────┐
  │  Redis  │                │ PostgreSQL  │
  │ Pub/Sub │                │ SKIP LOCKED │
  │  Locks  │                └──────┬──────┘
  └─────────┘                       │
                    ┌───────────────┼───────────────┐
                    │               │               │
             ┌──────▼──────┐ ┌──────▼──────┐ ┌─────▼───────┐
             │  Worker 1   │ │  Worker 2   │ │  Scheduler  │
             │ poll→claim  │ │ poll→claim  │ │ cron scan   │
             │ execute     │ │ execute     │ │ Redis lock  │
             │ retry / DLQ │ │ retry / DLQ │ └─────────────┘
             └─────────────┘ └─────────────┘
```

### Job Lifecycle

```
QUEUED ──► CLAIMED ──► RUNNING ──► COMPLETED
                           │
                        FAILED ──► (retry with backoff) ──► QUEUED
                           │
                        DEAD ◄── max retries exceeded
                           │
                     Dead Letter Queue
```

A job transitions through states atomically. Workers claim jobs using `SELECT FOR UPDATE SKIP LOCKED`, which guarantees that no two workers can claim the same job simultaneously — even when hundreds of workers poll the same queue concurrently.

---

## Technical Design

### Atomic Job Claiming

Workers issue a raw SQL update that selects and transitions a job from `QUEUED` to `CLAIMED` in a single atomic statement using `FOR UPDATE SKIP LOCKED`. Workers that find a locked row skip it without blocking and move to the next available job. This eliminates the need for any external coordination layer.

### Retry Engine

Each queue has an attached retry policy. On failure, the worker calculates the next execution time based on the queue's strategy and re-schedules the job. Jitter (±10%) is applied to all delays to prevent synchronised retry storms.

| Strategy | Delay Calculation |
|---|---|
| Fixed | `base_delay` every attempt |
| Linear | `base_delay × attempt_number` |
| Exponential | `base_delay × multiplier^(attempt - 1)` |

### Cron Scheduling

The scheduler is a separate process that scans `scheduled_jobs` every minute. It acquires a Redis distributed lock before processing to ensure only one scheduler instance runs at a time in a multi-instance deployment. Each cron trigger clones the template job into a new `jobs` row, preserving a complete execution history per trigger.

### Dead Letter Queue

When a job exhausts its retries, it transitions to `DEAD` and a `dead_letter_queue` record is created. The entry contains the failure reason, full stack trace, original payload, and attempt count. Failed jobs can be re-queued or resolved from the dashboard.

### WebSocket Live Updates

The API server maintains per-project WebSocket rooms. When a worker completes or fails a job, it publishes an event to Redis pub/sub. The API subscribes and forwards events to all connected dashboard clients. This design allows the API to run as multiple instances behind a load balancer without losing events.

---

## Database Schema

15 normalised tables. Full referential integrity with cascading deletes from project down through queues, jobs, executions, and logs.

| Table | Description |
|---|---|
| `users` | User accounts |
| `organizations` | Multi-tenant root entity |
| `org_memberships` | RBAC roles: Owner, Admin, Member |
| `projects` | Isolation unit; stores bcrypt-hashed API keys |
| `queues` | Job queues with embedded retry policy and rate limits |
| `jobs` | Central table; JSONB payload, full status machine, idempotency key |
| `job_executions` | One row per attempt; records duration, result, and error |
| `workers` | Self-registered worker processes |
| `worker_heartbeats` | Time-series telemetry per worker |
| `job_logs` | Append-only log lines per execution |
| `scheduled_jobs` | Cron template with `next_run_at` tracking |
| `dead_letter_queue` | Permanent failure records |
| `workflow_deps` | DAG edges for job dependency ordering |

**Critical index:** `(queue_id, status, scheduled_at)` on `jobs` — the hot path for every worker poll.

---

## API

All endpoints return structured JSON errors with a consistent `{ statusCode, error, message, details }` shape. Authentication uses JWT (dashboard) or project-scoped API keys (programmatic access).

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create user and organisation |
| `POST` | `/api/auth/login` | Authenticate, returns JWT |
| `GET` | `/api/auth/me` | Current user and memberships |
| `GET` | `/api/projects` | List accessible projects |
| `POST` | `/api/projects` | Create project, returns API key (shown once) |
| `POST` | `/api/projects/:id/rotate-key` | Rotate API key |
| `GET` | `/api/queues` | List queues with live counters |
| `POST` | `/api/queues` | Create queue |
| `PATCH` | `/api/queues/:id` | Update queue configuration |
| `POST` | `/api/queues/:id/pause` | Pause queue |
| `POST` | `/api/queues/:id/resume` | Resume queue |
| `GET` | `/api/queues/:id/stats` | Time-series execution stats |
| `POST` | `/api/jobs` | Create job (immediate, delayed, scheduled, or cron) |
| `POST` | `/api/jobs/batch` | Create up to 1,000 jobs atomically |
| `GET` | `/api/jobs` | List and filter jobs |
| `GET` | `/api/jobs/:id` | Full detail: executions, logs, dependencies |
| `POST` | `/api/jobs/:id/cancel` | Cancel a queued or scheduled job |
| `POST` | `/api/jobs/:id/retry` | Re-queue a failed or dead job |
| `GET` | `/api/workers` | List workers with heartbeat status |
| `POST` | `/api/workers/register` | Register a worker process |
| `POST` | `/api/workers/:id/heartbeat` | Send worker heartbeat |
| `GET` | `/api/metrics` | Throughput, success rate, queue breakdown |
| `GET` | `/api/dlq` | List dead letter queue entries |
| `POST` | `/api/dlq/:id/requeue` | Re-queue a dead job |
| `WS` | `/ws/events?projectId=` | Real-time job and worker events |

Full request/response schemas: [`docs/api-reference.md`](docs/api-reference.md)

---

## Project Structure

```
jobflow/
├── backend/
│   ├── prisma/schema.prisma
│   ├── src/
│   │   ├── server.ts
│   │   ├── db/
│   │   │   ├── prisma.ts
│   │   │   ├── redis.ts
│   │   │   └── seed.ts
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── projects.ts
│   │   │   ├── queues.ts
│   │   │   ├── jobs.ts
│   │   │   ├── workers.ts
│   │   │   ├── metrics.ts
│   │   │   ├── dlq.ts
│   │   │   └── websocket.ts
│   │   ├── worker/
│   │   │   ├── runner.ts
│   │   │   └── scheduler.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   └── errorHandler.ts
│   │   └── utils/
│   │       ├── logger.ts
│   │       └── retry.ts
│   └── tests/
│       ├── retry.test.ts
│       └── jobs.test.ts
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── index.css
│       ├── api/client.ts
│       ├── contexts/AuthContext.tsx
│       ├── hooks/useWebSocket.ts
│       ├── components/
│       │   ├── Sidebar.tsx
│       │   └── Toast.tsx
│       └── pages/
│           ├── LoginPage.tsx
│           ├── DashboardPage.tsx
│           ├── QueuesPage.tsx
│           ├── JobsPage.tsx
│           ├── WorkersPage.tsx
│           ├── MetricsPage.tsx
│           └── DLQPage.tsx
├── docs/
│   ├── architecture.md
│   ├── er-diagram.md
│   ├── api-reference.md
│   └── design-decisions.md
├── docker-compose.yml
├── requirements.txt
└── README.md
```

---

## Getting Started

### Prerequisites

See [`requirements.txt`](requirements.txt) for full system requirements.

- Node.js 20+
- PostgreSQL 16
- Redis 7 (optional — disables distributed locking and WebSocket pub/sub if absent)
- Docker and Docker Compose (for the containerised setup)

### Option 1 — Docker

```bash
docker compose up -d
```

Wait approximately 30 seconds for all services to initialise, then seed the database:

```bash
docker exec jobflow-api sh -c "npx prisma migrate deploy && npm run db:seed"
```

Open `http://localhost:5173` and sign in with `demo@jobflow.dev` / `password123`.

### Option 2 — Local Development

Start the infrastructure:

```bash
docker run -d --name jf-postgres \
  -e POSTGRES_USER=jobflow \
  -e POSTGRES_PASSWORD=jobflow \
  -e POSTGRES_DB=jobflow \
  -p 5432:5432 postgres:16-alpine

docker run -d --name jf-redis -p 6379:6379 redis:7-alpine
```

Copy the environment file and start the API:

```bash
cd backend
cp .env.example .env
npm install
npx prisma db push
npm run db:seed
npm run dev
```

In separate terminals, start the worker and scheduler:

```bash
# Terminal 2
cd backend && npm run worker

# Terminal 3
cd backend && npm run scheduler
```

Start the frontend:

```bash
cd frontend
npm install
npm run dev
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Minimum 32 characters |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL |
| `PORT` | No | `3001` | API server port |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Allowed frontend origin |
| `WORKER_CONCURRENCY` | No | `5` | Max concurrent jobs per worker process |
| `WORKER_POLL_INTERVAL_MS` | No | `1000` | Worker polling frequency in milliseconds |
| `WORKER_HEARTBEAT_INTERVAL_MS` | No | `10000` | Heartbeat interval in milliseconds |
| `WORKER_QUEUE_IDS` | No | all | Comma-separated queue UUIDs to pin this worker to |
| `WORKER_PROJECT_ID` | No | first found | Project UUID for worker registration |
| `OPENAI_API_KEY` | No | — | Enables AI-generated failure summaries in the DLQ |

---

## Running Tests

```bash
cd backend
npm test
```

```
Test Files  2 passed (2)
Tests      13 passed (13)
```

---

## Tech Stack

| | Technology | Version |
|---|---|---|
| API | Fastify | 4.x |
| Language | TypeScript | 5.7 |
| ORM | Prisma | 5.x |
| Database | PostgreSQL | 16 |
| Cache / Pub-Sub | Redis + IORedis | 7 / 5.x |
| Auth | JWT + bcrypt | — |
| Validation | Zod | 3.x |
| Logging | Pino | 9.x |
| Frontend | React + Vite | 19 / 8.x |
| Data Fetching | TanStack Query | 5.x |
| Charts | Recharts | 3.x |
| Testing | Vitest | 2.x |
| Containers | Docker + Compose | — |

---

## Documentation

| Document | Description |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | System design, component responsibilities, scaling strategy |
| [`docs/er-diagram.md`](docs/er-diagram.md) | Full ER diagram with index rationale |
| [`docs/api-reference.md`](docs/api-reference.md) | Endpoint schemas, error formats, WebSocket events |
| [`docs/design-decisions.md`](docs/design-decisions.md) | Architectural trade-off analyses |

---

## License

MIT
