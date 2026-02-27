# Deployment Profile — OpenClaw Hosted + Local DB

## Profile ID

`openclaw-hosted-localdb-v1`

## Purpose

This profile defines the target production-style setup for Life Coach v2:

- API runtime hosted by OpenClaw
- Redis running locally on host
- PostgreSQL running locally on host
- Scheduler delivery via Redis/Webhook transport

Profile file:
- `config/deployment/openclaw-local.profile.json`

Env template:
- `config/deployment/openclaw-local.env.example`

---

## Readiness check

Run:

```bash
npm run deploy:check
```

This performs:

1. Deployment profile existence + parse check
2. Required env check
3. Recommended env visibility check
4. Schema file check (`storage/postgres/init.sql`)
5. Redis/PostgreSQL connectivity check

The command prints a JSON report and exits non-zero if critical checks fail.

---

## One-command deploy wrapper

Run preflight then start API in one command:

```bash
npm run deploy:up
```

Useful variants:

```bash
npm run deploy:preflight               # check-only
npm run deploy:smoke                   # managed lifecycle: start API -> run quick smoke -> stop API
npm run deploy:smoke:deep              # managed lifecycle: start API -> run deep smoke -> stop API
npm run deploy:canary                  # managed lifecycle: start API -> canary traffic validation -> stop API
npm run deploy:up -- --skip-check      # start API directly (not recommended)
npm run deploy:up -- --profile=/abs/path/to/profile.json
```

Wrapper script:
- `scripts/deploy-wrapper.js`

---

## Baseline deployment checklist

1. Copy env template and customize:
   - `cp config/deployment/openclaw-local.env.example .env`
2. Ensure local services are running:
   - Redis on `REDIS_HOST:REDIS_PORT`
   - PostgreSQL reachable by `DATABASE_URL`
3. Run one-command preflight + startup:
   - `npm run deploy:up`
   - (or check-only: `npm run deploy:preflight`)
4. Verify health endpoint:
   - `GET /health`

---

## Notes

- `RATE_LIMIT_BACKEND=redis` is recommended for shared policy in multi-process runs.
- Scheduler delivery mode is controlled by `CRON_DELIVERY_MODE`:
  - `none` | `redis` | `webhook`
- Inline dispatch retry is controlled by:
  - `SCHEDULER_INLINE_RETRY_MAX`
