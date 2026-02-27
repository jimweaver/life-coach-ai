# Metrics System Documentation

Complete reference for the Life Coach AI metrics and observability system.

## Overview

The metrics system provides comprehensive observability into the Life Coach AI platform, covering performance, health, and operational aspects across all components.

## Quick Start

```bash
# Unified dashboard - all metrics in one view
curl http://localhost:8787/metrics/dashboard

# Health checks
curl http://localhost:8787/health
curl http://localhost:8787/health/deep
curl http://localhost:8787/ready

# Individual metric endpoints
curl http://localhost:8787/metrics/orchestrator
curl http://localhost:8787/metrics/latency
curl http://localhost:8787/metrics/memory
```

---

## Health Endpoints

### GET /health
Basic health status with essential service checks.

**Response:**
```json
{
  "ok": true,
  "services": {
    "database": "connected",
    "redis": "connected",
    "orchestrator": "initialized"
  },
  "timestamp": "2026-02-27T14:30:00.000Z"
}
```

### GET /health/pools
Connection pool monitoring for PostgreSQL and Redis.

**Response:**
```json
{
  "ok": true,
  "postgres": {
    "total": 20,
    "idle": 15,
    "waiting": 0,
    "max": 20,
    "utilization": 0.25
  },
  "redis": {
    "status": "connected",
    "reconnects": 0
  },
  "healthy": {
    "postgres": true,
    "redis": true,
    "overall": true
  }
}
```

### GET /health/deep
Comprehensive health diagnostics with detailed checks.

**Response:**
```json
{
  "ok": true,
  "checks": {
    "connectivity": { "ok": true, "latency_ms": 5 },
    "pool_health": { "ok": true, "postgres_utilization": 0.25 },
    "query_performance": { "ok": true, "avg_query_ms": 12 },
    "memory": { "ok": true, "heap_used_mb": 85 },
    "connections": { "ok": true, "active_sockets": 3 },
    "shutdown_status": { "ok": true, "shutting_down": false }
  },
  "overall_latency_ms": 45,
  "timestamp": "2026-02-27T14:30:00.000Z"
}
```

### GET /ready
Production readiness check for load balancers.

**Response:**
```json
{
  "ok": true,
  "status": "ready",
  "accepting_traffic": true,
  "active_requests": 2,
  "shutdown_grace_ms": 30000
}
```

---

## Metrics Endpoints

### GET /metrics/orchestrator
Orchestrator engine performance metrics.

**Metrics:**
- Request counts (total, by mode, by domain)
- Latency histogram with percentiles (p50, p95, p99)
- Error rates and error types
- Agent execution time by domain
- System uptime

**Response:**
```json
{
  "ok": true,
  "uptime_ms": 3600000,
  "uptime_formatted": "1h 0m",
  "requests": {
    "total": 1523,
    "by_mode": { "single_domain": 1200, "multi_domain": 323 },
    "by_domain": { "career": 800, "health": 400, "finance": 323 },
    "rate_per_minute": "25.38"
  },
  "latency": {
    "average_ms": 245,
    "histogram": { "under100": 200, "under500": 1000, "under1000": 300, "under2000": 20, "over2000": 3 },
    "percentiles": { "p50": 180, "p95": 890, "p99": 1500 }
  },
  "errors": {
    "total": 5,
    "rate": "0.33%",
    "by_type": { "ValidationError": 3, "TimeoutError": 2 }
  },
  "agent_execution": {
    "total": 1523,
    "avg_ms": 180,
    "by_domain": [
      { "domain": "career", "total": 800, "avg_ms": 150, "min_ms": 50, "max_ms": 2000 },
      { "domain": "health", "total": 400, "avg_ms": 200, "min_ms": 80, "max_ms": 3000 }
    ],
    "slow_executions": { "count": 10, "recent": [...] }
  }
}
```

### GET /metrics/latency
API request latency histogram with per-route statistics.

**Buckets:**
- under10: <10ms
- under50: 10-50ms
- under100: 50-100ms
- under250: 100-250ms
- under500: 250-500ms
- under1000: 500ms-1s
- under2000: 1-2s
- over2000: >2s

**Response:**
```json
{
  "ok": true,
  "histogram": {
    "under10": 50,
    "under50": 200,
    "under100": 500,
    "under250": 400,
    "under500": 250,
    "under1000": 100,
    "under2000": 20,
    "over2000": 3
  },
  "total_requests": 1523,
  "routes": [
    { "route": "/chat", "count": 800, "avg_ms": 245, "error_rate": "0.25%" },
    { "route": "/health", "count": 500, "avg_ms": 5, "error_rate": "0%" }
  ],
  "generated_at": "2026-02-27T14:30:00.000Z"
}
```

### GET /metrics/response-size
API response size distribution with per-route statistics.

**Buckets:**
- under1kb: <1KB
- under10kb: 1-10KB
- under50kb: 10-50KB
- under100kb: 50-100KB
- under500kb: 100-500KB
- under1mb: 500KB-1MB
- over1mb: >1MB

**Response:**
```json
{
  "ok": true,
  "histogram": {
    "under1kb": 200,
    "under10kb": 800,
    "under50kb": 400,
    "under100kb": 100,
    "under500kb": 20,
    "under1mb": 3,
    "over1mb": 0
  },
  "total_responses": 1523,
  "routes": [
    { "route": "/chat", "count": 800, "avg_kb": 4.5, "total_mb": 3.52 },
    { "route": "/metrics/dashboard", "count": 100, "avg_kb": 12.3, "total_mb": 1.23 }
  ],
  "largest_routes": [
    { "route": "/metrics/dashboard", "total_mb": 1.23, "count": 100 },
    { "route": "/chat", "total_mb": 3.52, "count": 800 }
  ],
  "generated_at": "2026-02-27T14:30:00.000Z"
}
```

### GET /metrics/queries
Database query performance metrics.

**Response:**
```json
{
  "ok": true,
  "total_queries": 5000,
  "total_errors": 2,
  "error_rate": "0.04%",
  "avg_duration_ms": 15,
  "slow_query_count": 3,
  "recent_slow_queries": [
    { "type": "SELECT", "duration": 1200, "timestamp": "...", "preview": "SELECT * FROM conversations..." }
  ],
  "query_types": [
    { "type": "SELECT", "count": 3000, "avg_ms": 12, "error_rate": "0.03%" },
    { "type": "INSERT", "count": 1500, "avg_ms": 18, "error_rate": "0.07%" },
    { "type": "UPDATE", "count": 500, "avg_ms": 25, "error_rate": "0%" }
  ],
  "generated_at": "2026-02-27T14:30:00.000Z"
}
```

### GET /metrics/cache
Cache hit/miss rate tracking by key pattern.

**Response:**
```json
{
  "ok": true,
  "hits": 8500,
  "misses": 1500,
  "sets": 2000,
  "deletes": 500,
  "errors": 2,
  "hit_rate": "85.00%",
  "miss_rate": "15.00%",
  "total_operations": 12500,
  "key_patterns": [
    { "pattern": "session", "hits": 5000, "misses": 500, "hit_rate": "90.91%" },
    { "pattern": "rate-limit", "hits": 3500, "misses": 1000, "hit_rate": "77.78%" }
  ],
  "generated_at": "2026-02-27T14:30:00.000Z"
}
```

### GET /metrics/delivery
Webhook delivery success rate metrics.

**Response:**
```json
{
  "ok": true,
  "total_deliveries": 1000,
  "successful": 950,
  "failed": 50,
  "success_rate": "95.00%",
  "by_mode": [
    { "mode": "webhook", "total": 800, "successful": 760, "failed": 40, "success_rate": "95.00%" },
    { "mode": "redis", "total": 200, "successful": 190, "failed": 10, "success_rate": "95.00%" }
  ],
  "error_reasons": [
    { "reason": "timeout", "count": 30 },
    { "reason": "http_500", "count": 20 }
  ],
  "response_time_ms": { "avg": 250, "min": 50, "max": 5000 },
  "recent_errors": [...],
  "generated_at": "2026-02-27T14:30:00.000Z"
}
```

### GET /metrics/model
Model call latency and success rate tracking.

**Response:**
```json
{
  "ok": true,
  "total_calls": 500,
  "successful": 475,
  "failed": 25,
  "success_rate": "95.00%",
  "avg_duration_ms": 1500,
  "by_model": [
    { "model": "gpt-4o-mini", "total": 300, "successful": 285, "failed": 15, "success_rate": "95.00%", "avg_ms": 1200 },
    { "model": "claude-opus", "total": 200, "successful": 190, "failed": 10, "success_rate": "95.00%", "avg_ms": 2000 }
  ],
  "by_domain": [
    { "domain": "career", "total": 200, "successful": 190, "failed": 10, "success_rate": "95.00%", "avg_ms": 1400 },
    { "domain": "health", "total": 150, "successful": 143, "failed": 7, "success_rate": "95.33%", "avg_ms": 1600 }
  ],
  "retry_distribution": { "0": 400, "1": 80, "2": 15, "3plus": 5 },
  "error_reasons": [...],
  "slow_calls": { "count": 10, "recent": [...] },
  "generated_at": "2026-02-27T14:30:00.000Z"
}
```

### GET /metrics/memory
Process memory usage metrics.

**Response:**
```json
{
  "ok": true,
  "heap_used_mb": 85.5,
  "heap_total_mb": 120.0,
  "rss_mb": 150.2,
  "external_mb": 12.3,
  "array_buffers_mb": 5.1,
  "heap_utilization_percent": 71.25,
  "uptime_seconds": 3600,
  "node_version": "v22.22.0",
  "platform": "darwin",
  "pid": 12345,
  "generated_at": "2026-02-27T14:30:00.000Z"
}
```

---

## Unified Dashboard

### GET /metrics/dashboard
Single endpoint that aggregates all metrics for a complete system view.

**Response Structure:**
```json
{
  "ok": true,
  "summary": {
    "api_requests": 1523,
    "orchestrator_requests": 1523,
    "db_queries": 5000,
    "db_pool_utilization": "25%",
    "overall_health": true,
    "response_stats": { "total_responses": 1523, "total_mb": 5.2, "avg_kb_per_response": 3.5 },
    "cache_stats": { "hit_rate": "85.00%", "total_ops": 12500, "top_pattern": "session" },
    "delivery_stats": { "total_deliveries": 1000, "success_rate": "95.00%", "avg_response_ms": 250 },
    "model_stats": { "total_calls": 500, "success_rate": "95.00%", "avg_duration_ms": 1500, "slow_calls": 10 },
    "memory_stats": { "heap_used_mb": 85.5, "heap_utilization_percent": 71.25, "uptime_seconds": 3600 }
  },
  "services": {
    "orchestrator": { ... },
    "pools": { ... },
    "queries": { ... },
    "cache": { ... },
    "delivery": { ... },
    "model": { ... },
    "memory": { ... },
    "latency": { "histogram": {...}, "total_requests": 1523 },
    "response_size": { "histogram": {...}, "total_responses": 1523 }
  },
  "generated_at": "2026-02-27T14:30:00.000Z"
}
```

---

## Deploy Event Metrics

### GET /jobs/deploy-events/trend/rollup
Aggregated deploy event statistics for trend dashboards.

**Query Parameters:**
- `sinceMinutes`: Time window (default: 1440 = 24h)
- `bucketMinutes`: Bucket size (default: 60 = 1h)
- `runId`: Filter by specific run
- `source`: Filter by source

**Response:**
```json
{
  "ok": true,
  "filters": { "sinceMinutes": 1440, "bucketMinutes": 60 },
  "rollup": {
    "total_buckets": 24,
    "total_events": 1000,
    "total_errors": 50,
    "total_warns": 100,
    "avg_events_per_bucket": 42,
    "error_rate": "5.00%",
    "peak_bucket": { "time": "2026-02-27T10:00:00Z", "total_events": 100, "error_events": 10 },
    "trend_direction": "stable",
    "first_half_avg": 40,
    "second_half_avg": 44
  },
  "timeline": [...],
  "anomaly_trend": [...],
  "summary": {...}
}
```

---

## Testing

All metrics endpoints have dedicated tests:

```bash
# Individual metric tests
npm run test:orchestrator-metrics
npm run test:latency-metrics
npm run test:response-size
npm run test:query-metrics
npm run test:cache
npm run test:delivery-metrics
npm run test:model-metrics
npm run test:memory-metrics
npm run test:agent-execution
npm run test:pool-metrics
npm run test:deep-health
npm run test:metrics-dashboard

# Graceful shutdown verification
npm run test:graceful
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | 8787 |
| `RATE_LIMIT_BACKEND` | Rate limiting backend (redis/memory) | redis |
| `CRON_DELIVERY_MODE` | Event delivery mode (redis/webhook/none) | none |
| `SHUTDOWN_EVENT_SINK_ENABLED` | Log shutdown events | false |

---

## Version History

- **Day 57-70**: Initial metrics system implementation (14 endpoints)
- **v1.0.0**: Complete observability chapter

---

*Last updated: 2026-02-27*
