# Deployment Operations — Rollback + Smoke-Check Playbook

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run deploy:preflight` | Validate env + connectivity before deploy |
| `npm run deploy:up` | Preflight + start API |
| `npm run deploy:smoke` | Managed smoke orchestration (start API -> quick smoke -> stop API) |
| `npm run deploy:smoke:deep` | Managed smoke orchestration (start API -> deep smoke -> stop API) |
| `npm run deploy:canary` | Post-deploy canary validation (traffic probe + rollback decision) |
| `npm run smoke:check` | Post-deploy health + sanity checks |
| `npm run smoke:deep` | Extended checks (DB, Redis, key endpoints) |

---

## Smoke Checks

### Quick smoke (after deploy)

```bash
npm run smoke:check
```

Verifies:
1. API process is running
2. Health endpoint returns `ok: true`
3. Response time < 2s

### Deep smoke (after major changes)

```bash
npm run smoke:deep
```

Verifies:
1. All quick smoke checks
2. Redis connectivity
3. PostgreSQL connectivity + schema version
4. Sample read/write roundtrip (creates + deletes test profile)
5. Scheduler delivery mode matches expected

### Orchestrated smoke mode (managed lifecycle)

```bash
npm run deploy:smoke
npm run deploy:smoke:deep
```

Wrapper flow:
1. Run preflight (`deploy:check`)
2. Start API managed child process
3. Wait for `/ready`
4. Run smoke checks (`quick` or `deep`)
5. Gracefully stop API process

### Canary flow (traffic validation + rollback recommendation)

```bash
npm run deploy:canary
```

Canary executes a lightweight traffic transaction (`profile -> goals -> chat`) multiple times,
then evaluates rollback decision thresholds.

Rollback recommendation is triggered when one of these thresholds is exceeded:

- `CANARY_MAX_ERROR_RATE` (default `0.2`)
- `CANARY_P95_MAX_MS` (default `3500`)
- `CANARY_AVG_MAX_MS` (default `2200`)

The canary result is printed as JSON and exits non-zero on rollback recommendation.

### Canary baseline profiling (auto-calibration)

Canary reports are persisted to history (`CANARY_HISTORY_FILE`, default `logs/canary-history.jsonl`).
You can derive suggested thresholds from historical runs:

```bash
npm run canary:profile
```

This returns a baseline profile with suggested values for:
- `max_error_rate`
- `max_p95_ms`
- `max_avg_ms`

Use it to tune canary thresholds over time instead of static defaults.

### Canary profile drift alarms

Detect when active canary thresholds drift too far from history-derived baseline:

- `GET /jobs/canary/drift`
  - Optional params:
    - `minSamples=<int>`
    - `route=true|false`
    - `emitAudit=true|false`
    - `historyFile=/abs/path/history.jsonl`

Trend analysis over recent windows:

- `GET /jobs/canary/drift-trend`
  - Optional params:
    - `sinceMinutes=<int>`
    - `bucketMinutes=<int>`
    - `minSamples=<int>`
    - `historyFile=/abs/path/history.jsonl`

Routing behavior:
- Controlled by `CANARY_DRIFT_ROUTE_ENABLED` (default: `true`)
- Minimum routed severity controlled by `CANARY_DRIFT_ROUTE_MIN_LEVEL` (`warn|critical`)

Drift thresholds:
- `CANARY_DRIFT_WARN_RATIO` (default: `0.25`)
- `CANARY_DRIFT_CRITICAL_RATIO` (default: `0.5`)

Audit signal:
- `agent_logs.action = canary_profile_drift_detected`

### Deploy-wrapper observability hooks

Set `DEPLOY_WRAPPER_LOG_FORMAT=json` to emit structured JSON events with step durations.

Example events:
- `wrapper.start`
- `preflight.start` / `preflight.end`
- `ready.wait.start` / `ready.wait.end`
- `smoke.quick.start` / `smoke.quick.end`
- `canary.traffic.start` / `canary.traffic.end`
- `api.stop.start` / `api.stop.end`
- `wrapper.complete`

Each event includes `ts` and timing fields like `duration_ms` / `total_ms` when applicable.

### Deploy event sink (DB persistence)

Wrapper events can be persisted to PostgreSQL for deployment analytics.

- Enable sink: `DEPLOY_WRAPPER_EVENT_SINK=postgres`
- Disable sink: `DEPLOY_WRAPPER_EVENT_SINK=none`
- Table name: `DEPLOY_WRAPPER_EVENT_TABLE` (default: `deploy_run_events`)
- Source label: `DEPLOY_WRAPPER_EVENT_SOURCE` (default: `deploy-wrapper`)

Stored event fields:
- `run_id`
- `source`
- `level`
- `event`
- `event_ts`
- `payload` (JSONB)

Deploy event analytics APIs:
- `GET /jobs/deploy-events`
  - filters: `runId`, `event`, `level`, `sinceMinutes`, `limit`
- `GET /jobs/deploy-events/summary`
  - filters: `runId`, `sinceMinutes`
  - grouped output by `event + level`
- `GET /jobs/deploy-events/trend`
  - filters: `runId`, `source`, `sinceMinutes`, `bucketMinutes`, `runLimit`, `timelineLimit`, `heatmapLimit`
  - returns per-run timeline buckets + failure heatmap

Validation:

```bash
npm run test:deploy-sink
npm run test:deploy-analytics
npm run test:deploy-trend
```

---

## Rollback Procedures

### Scenario: API startup failure

1. Check preflight output:
   ```bash
   npm run deploy:preflight 2>&1 | tee preflight.log
   ```

2. Common fixes:
   - `DATABASE_URL` unreachable → verify PostgreSQL service
   - `REDIS_HOST` unreachable → verify Redis service
   - Missing env vars → copy from `config/deployment/openclaw-local.env.example`

3. Restart after fix:
   ```bash
   npm run deploy:up
   ```

### Scenario: API running but unhealthy

1. Check health endpoint:
   ```bash
   curl -s http://localhost:8787/health | jq .
   ```

2. Check logs:
   ```bash
   # If running via deploy:up
   tail -f ~/.openclaw/logs/life-coach-api.log
   ```

3. If Redis/Postgres unhealthy:
   - Restart services
   - Re-run `npm run deploy:up`

### Scenario: need to revert to previous version

1. Stop current API:
   ```bash
   pkill -f "node core/api-server.js"
   ```

2. Checkout previous commit:
   ```bash
   git log --oneline -n 5
   git checkout <previous-commit-hash>
   ```

3. Re-run preflight + start:
   ```bash
   npm run deploy:up
   ```

4. Verify with smoke check:
   ```bash
   npm run smoke:check
   ```

---

## Env Variables for Operations

| Variable | Default | Purpose |
|----------|---------|---------|
| `SMOKE_CHECK_TIMEOUT_MS` | 5000 | Health endpoint timeout |
| `SMOKE_CHECK_RETRIES` | 3 | Retry attempts for flaky checks |
| `SMOKE_CHECK_BASE_URL` | http://localhost:8787 | API base URL |
| `SHUTDOWN_GRACE_MS` | 10000 | Graceful shutdown wait before force-closing sockets |
| `CANARY_REQUEST_COUNT` | 3 | Number of synthetic canary transactions |
| `CANARY_REQUEST_TIMEOUT_MS` | 10000 | Timeout per canary transaction |
| `CANARY_MAX_ERROR_RATE` | 0.2 | Rollback threshold for failed request ratio |
| `CANARY_P95_MAX_MS` | 3500 | Rollback threshold for p95 latency |
| `CANARY_AVG_MAX_MS` | 2200 | Rollback threshold for average latency |
| `CANARY_HISTORY_ENABLED` | true | Persist canary run metrics to history |
| `CANARY_HISTORY_FILE` | `logs/canary-history.jsonl` | Canary history file path |
| `CANARY_PROFILE_MIN_SAMPLES` | 5 | Minimum history samples for baseline profile |
| `CANARY_PROFILE_ERROR_HEADROOM` | 0.02 | Error-rate buffer for suggested threshold |
| `CANARY_PROFILE_LATENCY_MULTIPLIER` | 1.2 | Latency multiplier for suggested thresholds |
| `CANARY_DRIFT_WARN_RATIO` | 0.25 | Warn threshold for active-vs-suggested ratio delta |
| `CANARY_DRIFT_CRITICAL_RATIO` | 0.5 | Critical threshold for active-vs-suggested ratio delta |
| `CANARY_DRIFT_ROUTE_ENABLED` | true | Enable routing when canary drift is detected |
| `CANARY_DRIFT_ROUTE_MIN_LEVEL` | warn | Minimum drift level routed via alert router |
| `CANARY_DRIFT_TREND_DEFAULT_SINCE_MINUTES` | 1440 | Default lookback window for drift trend endpoint |
| `CANARY_DRIFT_TREND_DEFAULT_BUCKET_MINUTES` | 60 | Default bucket size for drift trend endpoint |
| `DEPLOY_WRAPPER_LOG_FORMAT` | text | Wrapper log format (`text` or `json`) |
| `DEPLOY_WRAPPER_READY_TIMEOUT_MS` | 20000 | Max wait for `/ready` in managed modes |
| `DEPLOY_WRAPPER_READY_INTERVAL_MS` | 500 | Poll interval for `/ready` |
| `DEPLOY_WRAPPER_STOP_TIMEOUT_MS` | 10000 | Max wait before force-stopping API child |
| `DEPLOY_WRAPPER_EVENT_SINK` | postgres | Deploy event sink mode (`postgres` or `none`) |
| `DEPLOY_WRAPPER_EVENT_TABLE` | deploy_run_events | Deploy event sink table name |
| `DEPLOY_WRAPPER_EVENT_SOURCE` | deploy-wrapper | Source label written to event sink |

---

## Production gate

Before release, run the full readiness checklist:

- `docs/PRODUCTION_READINESS_CHECKLIST.md`
- `docs/ALERT_DESTINATION_GOVERNANCE.md` (validate routing owners + escalation targets)

---

## Health Endpoint Fields

`GET /health` returns:

```json
{
  "ok": true,
  "services": {
    "redis": true,
    "postgres": true
  },
  "rate_limit_backend": "redis",
  "rate_limit_policy": { ... },
  "cron_delivery_mode": "redis",
  "dead_letter_replay_policy": { ... },
  "time": "2026-02-27T..."
}
```

Key fields to monitor:
- `ok` — overall health
- `services.redis` + `services.postgres` — storage health
- `dead_letter_replay_policy` — replay safety config
