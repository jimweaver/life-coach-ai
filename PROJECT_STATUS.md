# Life Coach AI — Project Status

Updated: 2026-02-27

## Current completion (OpenClaw-first)

### ✅ Done

1. **Core runtime + storage**
   - Local Redis + PostgreSQL installed and running
   - Schema initialized (users, conversations, messages, goals, kbi, patterns, prefs, logs, milestones)
   - DB manager implemented (`core/storage/database-storage.js`)

2. **14 Agent configs completed**
   - Core resident: orchestrator, context-memory, safety-guardian, career
   - Domain on-demand: health, finance, skill, relationship, decision
   - Shared services: data-collector, progress-tracker, conflict-resolver
   - Supervisory: kbi-monitor, intervention

3. **Orchestration engine implemented**
   - Intent classification (6 domains)
   - Single/multi-domain routing
   - Conflict detection/resolution hook
   - Safety check + emergency short-circuit
   - Persistence to Redis/PostgreSQL

4. **OpenClaw environment alignment**
   - Project docs mirrored into `.docs/life_coach_design`
   - Model routing aligned with requested strategy:
     - Orchestrator → Codex
     - Coding/conflict-critical → Opus
     - General/domain → Kimi

5. **API layer implemented** (`core/api-server.js`)
   - `GET /health`
   - `POST /chat`
   - `GET/POST /profile/:userId`
   - `GET/POST /goals/:userId`
   - `GET /kbi/:userId/:metric`
   - `GET /monitor/:userId`
   - `GET /intervention/morning/:userId`
   - `GET /intervention/weekly/:userId`
   - `POST /intervention/risk`

6. **Test coverage (all pass)**
   - DB connectivity and CRUD
   - Core agent config validation (14/14)
   - Model router validation
   - KBI/intervention logic
   - Day3 multi-domain flow
   - Day4 domain coverage
   - Scheduler runner cycle tests
   - E2E API flow (`chat -> db -> monitor/intervention`)

7. **Scheduled runner (initial) added**
   - `core/scheduler-runner.js`
   - Monitor cycle (`runMonitorCycle`) scans users and evaluates KBI alerts
   - Morning cycle (`runMorningCycle`) generates intervention messages
   - API job endpoints:
     - `POST /jobs/run-monitor-cycle`
     - `POST /jobs/run-morning-cycle`

8. **Production guardrails baseline**
   - Added `core/guardrails.js`
   - Request validation for chat/profile/goals/risk + userId param
   - POST rate limiting (env-controlled)
   - Added guardrail test: `test-api-guardrails.js`

9. **Data collector citation upgrade**
   - Added ranked multi-source citation scoring in `core/data-collector.js`
   - Snapshot now includes: `citations`, `confidence`, `reason`, `total_results`, `generated_at`
   - Added fallback + authority/relevance/domain-fit scoring heuristics
   - Orchestrator response now includes top citations with confidence line
   - Added test: `test-data-collector.js`

10. **Distributed rate-limit backend (Redis) added**
   - Added `createRedisRateLimiter` with memory fallback
   - API now supports `RATE_LIMIT_BACKEND=redis|memory`
   - Shared limiter key prefix via `RATE_LIMIT_KEY_PREFIX`
   - `/health` now exposes `rate_limit_backend`
   - Guardrails integration test now validates Redis-backed path

11. **Model-calling adapter baseline integrated**
   - Added `core/model-adapter.js` (OpenAI-compatible, env-driven)
   - `core/domain-agents.js` now attempts model generation first, with heuristic fallback
   - Supports `DOMAIN_MODEL_ADAPTER_MODE=off|auto|force`
   - Added adapter unit test: `test-model-adapter.js`

---

## In progress / next

1. Tune model-adapter quality controls:
   - strict JSON schema enforcement
   - retry/backoff and graceful degrade behavior
2. Connect scheduler jobs to actual OpenClaw cron-event delivery pipeline
3. Extend production guardrails:
   - audit log normalization
   - endpoint-level policy tuning (per-route thresholds)
4. Add external-source quality checks (freshness + duplicate suppression) for data collector
5. Prepare deployment profile (OpenClaw-hosted + local DB)

---

## Runbook

```bash
# API
npm run start:api

# Tests
npm run test:db
npm run test:agents
npm run test:model
npm run test:kbi
npm run test:day3
npm run test:day4
npm run test:scheduler
npm run test:guardrails
npm run test:data
npm run test:adapter
npm run test:e2e
```
