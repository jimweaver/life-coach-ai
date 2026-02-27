# Deployment Operations — Rollback + Smoke-Check Playbook

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run deploy:preflight` | Validate env + connectivity before deploy |
| `npm run deploy:up` | Preflight + start API |
| `npm run deploy:smoke` | Managed smoke orchestration (start API -> quick smoke -> stop API) |
| `npm run deploy:smoke:deep` | Managed smoke orchestration (start API -> deep smoke -> stop API) |
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
