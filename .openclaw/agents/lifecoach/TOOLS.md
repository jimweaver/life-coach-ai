# TOOLS.md - Life Coach AI Tools & Operations

## Life Coach API (Self-Reference)

**Base URL:** `http://localhost:8787`

### Core Coaching Endpoints

| Endpoint | Method | Use When | Request Body | Response |
|----------|--------|----------|--------------|----------|
| `/chat` | POST | User asks for coaching | `{userId, message, sessionId?}` | `{session_id, mode, intent, output}` |
| `/profile/{userId}` | GET | Need user profile | - | `{user_id, preferences, goals, ...}` |
| `/profile/{userId}` | POST | Update profile | `{name, timezone, preferences}` | Updated profile |
| `/goals/{userId}` | GET | List goals | - | Array of goals |
| `/goals/{userId}` | POST | Create/update goal | `{domain, title, target_date, priority}` | Created goal |
| `/kbi/{userId}/{metric}` | GET | Check specific KBI | - | KBI value and history |
| `/monitor/{userId}` | GET | Check KBI status | - | Monitor status |
| `/intervention/morning/{userId}` | GET | Morning check-in | - | Intervention message |

### Health & System Endpoints

| Endpoint | Method | Use When |
|----------|--------|----------|
| `/health` | GET | Quick health check |
| `/ready` | GET | Production readiness |
| `/health/deep` | GET | Comprehensive diagnostics (pools, queries, memory) |
| `/metrics/dashboard` | GET | Unified observability |
| `/metrics/alerts` | GET | Active alert evaluation |
| `/metrics/prometheus` | GET | Prometheus scrape format |
| `/metrics/orchestrator` | GET | Orchestrator performance |
| `/metrics/latency` | GET | Request latency histogram |
| `/metrics/queries` | GET | Database query performance |
| `/metrics/cache` | GET | Cache hit/miss rates |
| `/metrics/memory` | GET | Memory usage |
| `/metrics/response-size` | GET | Response size distribution |
| `/metrics/model` | GET | LLM call statistics |
| `/metrics/delivery` | GET | Webhook delivery stats |
| `/health/pools` | GET | Connection pool metrics |

### Scheduler & Job Endpoints

| Endpoint | Method | Use When |
|----------|--------|----------|
| `/jobs/run-monitor-cycle` | POST | Trigger KBI monitoring |
| `/jobs/run-morning-cycle` | POST | Trigger morning interventions |
| `/jobs/run-retry-cycle` | POST | Retry failed deliveries |
| `/jobs/dead-letter` | GET | View failed events |
| `/jobs/dead-letter/{id}/replay` | POST | Replay specific event |
| `/jobs/dead-letter/replay-bulk` | POST | Bulk replay with filters |
| `/jobs/dead-letter/replay-policy` | GET | Check replay policy |
| `/jobs/delivery/metrics` | GET | Delivery observability |
| `/jobs/delivery/alerts` | GET | Delivery alert evaluation |
| `/jobs/delivery/route-policy` | GET | Alert routing configuration |
| `/jobs/delivery/ownership-drift` | GET | Ownership drift detection |
| `/jobs/canary/drift` | GET | Canary profile drift |
| `/jobs/canary/drift-trend` | GET | Drift trend analysis |

### Deploy & Analytics Endpoints

| Endpoint | Method | Use When |
|----------|--------|----------|
| `/jobs/deploy-events` | GET | Deploy event query |
| `/jobs/deploy-events/summary` | GET | Deploy summary stats |
| `/jobs/deploy-events/trend` | GET | Deploy trend analysis |
| `/jobs/deploy-events/dashboard` | GET | Deploy dashboard |
| `/jobs/deploy-events/anomalies` | GET | Deploy anomaly detection |
| `/jobs/deploy-events/anomalies/telemetry` | GET | Telemetry metrics |
| `/analytics/skill-learning` | GET | Skill learning analytics |
| `/data-quality/probe` | GET | Data quality check |
| `/data-quality/domains` | GET | Supported domains |

## Telegram Bot

| Item | Value |
|------|-------|
| **Username** | [@Evelyn_agent_bot](https://t.me/Evelyn_agent_bot) |
| **Bot ID** | 8689595774 |
| **Owner** | TJ (7795502280) |
| **Integration** | OpenClaw gateway routes messages to Life Coach agent |

## External Tools Available

### Web Search (Brave)
```javascript
// Use for research
web_search({ query: "best practices for career transition" })
```

### Web Fetch
```javascript
// Use for detailed content
web_fetch({ url: "https://example.com/article" })
```

### File Operations
```javascript
// Read user profiles, conversation history
read({ file_path: "memory/2026-02-27.md" })
```

### Shell
```javascript
// Check system health
exec({ command: "curl http://localhost:8787/health" })
```

## Quick Commands

### System Health
```bash
# Quick health check
curl http://localhost:8787/health

# Deep diagnostics
curl http://localhost:8787/health/deep

# View all metrics
curl http://localhost:8787/metrics/dashboard | python3 -m json.tool

# Check alerts
curl http://localhost:8787/metrics/alerts
```

### Starting the System
```bash
# Preflight check
npm run deploy:preflight

# Start API
npm run deploy:up

# With smoke test
npm run deploy:smoke

# With canary validation
npm run deploy:canary
```

### Running Tests
```bash
# All tests
npm test

# Specific suites
npm run test:db          # Database connectivity
npm run test:agents      # Agent configurations
npm run test:orchestrator # Main processing
npm run test:scheduler   # Cron jobs
npm run test:metrics     # Metrics system
npm run test:delivery    # Delivery pipeline
npm run test:e2e         # End-to-end
npm run test:graceful    # Shutdown behavior
```

### Database Operations
```bash
# Initialize schema
npm run db:init

# Check PostgreSQL
psql -h localhost -U tj -d life_coach -c "SELECT COUNT(*) FROM users;"

# Check Redis
redis-cli ping
redis-cli info stats
```

## Environment Variables

### Required
```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/life_coach
REDIS_HOST=localhost
REDIS_PORT=6379
OPENAI_API_KEY=sk-...
BRAVE_API_KEY=...
PORT=8787
```

### Model Configuration
```bash
DOMAIN_MODEL_ADAPTER_MODE=auto  # off | auto | force
DOMAIN_MODEL_RETRY_MAX=2
DOMAIN_MODEL_RETRY_BASE_DELAY_MS=500
```

### Rate Limiting
```bash
RATE_LIMIT_BACKEND=redis
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
# Per-route limits:
RATE_LIMIT_MAX_CHAT=60
RATE_LIMIT_MAX_JOBS=30
RATE_LIMIT_MAX_INTERVENTION=20
```

### Scheduler
```bash
SCHEDULER_MONITOR_CYCLE_INTERVAL_MS=14400000
SCHEDULER_MORNING_CYCLE_HOUR=9
SCHEDULER_MORNING_CYCLE_MINUTE=0
SCHEDULER_MORNING_CYCLE_TIMEZONE=America/Los_Angeles
SCHEDULER_INLINE_RETRY_MAX=1
```

### Alert Routing
```bash
DELIVERY_ALERT_ROUTE_STRATEGY=severity
DELIVERY_ALERT_ESCALATION_ENABLED=true
DELIVERY_ALERT_ESCALATION_MIN_LEVEL=critical
DELIVERY_ALERT_ONCALL_SYNC_ENABLED=true
DELIVERY_ALERT_ONCALL_FILE=/path/to/roster.json
```

### Deploy Wrapper
```bash
DEPLOY_WRAPPER_LOG_FORMAT=json
DEPLOY_WRAPPER_EVENT_SINK=postgres
SHUTDOWN_EVENT_SINK_ENABLED=true
```

## Troubleshooting Guide

### API Not Responding
```bash
# Check if running
ps aux | grep "api-server"

# Check port usage
lsof -i :8787

# Check logs
tail -f logs/api.log

# Restart
npm run deploy:up
```

### High Latency
```bash
# Check latency metrics
curl http://localhost:8787/metrics/latency

# Check slow queries
curl http://localhost:8787/metrics/queries

# Check cache hit rate
curl http://localhost:8787/metrics/cache

# Check connection pools
curl http://localhost:8787/health/pools
```

### Database Issues
```bash
# Check PostgreSQL status
brew services list | grep postgresql

# Check connection
curl http://localhost:8787/health/deep | jq '.checks.pool_health'

# Check Redis
redis-cli ping
redis-cli info | grep connected_clients
```

### Memory Issues
```bash
# Check memory usage
curl http://localhost:8787/metrics/memory

# Check heap utilization
curl http://localhost:8787/metrics/memory | jq '.heap_utilization'
```

## Performance Targets

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| P50 latency | < 200ms | 500ms | 1000ms |
| P95 latency | < 500ms | 1000ms | 2000ms |
| P99 latency | < 1000ms | 2000ms | 5000ms |
| Error rate | < 0.1% | 1% | 5% |
| Cache hit rate | > 80% | 70% | 50% |
| DB query avg | < 50ms | 100ms | 200ms |
| Memory usage | < 70% | 85% | 95% |

## Key File Locations

| Component | Path |
|-----------|------|
| API Server | `core/api-server.js` |
| Orchestrator | `core/orchestrator-engine.js` |
| Domain Agents | `core/domain-agents.js` |
| Database Manager | `core/storage/database-storage.js` |
| Scheduler | `core/scheduler-runner.js` |
| Model Adapter | `core/model-adapter.js` |
| Agent Configs | `agents/*/config.yml` |
| Documentation | `.docs/life_coach_design/` |

## Related Documentation

- `SKILL.md` — Agent skill definition
- `AGENTS.md` — Full system specification
- `SOUL.md` — Core beliefs and approach
- `IDENTITY.md` — Visual identity and voice
- `USER.md` — TJ profile
- `HEARTBEAT.md` — Monitoring routine

---

_Update this file as you discover new tools and shortcuts._
