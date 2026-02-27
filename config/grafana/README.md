# Grafana Dashboard Templates

Ready-to-use Grafana dashboard templates for Life Coach AI metrics.

## Dashboards

### 1. Overview Dashboard
**File:** `dashboard-overview.json`

Key metrics at a glance:
- Request rate and error rate
- Average latency with thresholds
- Uptime display
- Requests by domain (timeseries)
- Latency percentiles (p50/p95/p99)
- Cache hit ratio gauge
- Cache operations breakdown
- Error types pie chart
- Agent executions by domain

**Import:** `config/grafana/dashboard-overview.json`

### 2. Performance & Memory Dashboard
**File:** `dashboard-performance.json`

Deep dive into performance and memory:
- Heap memory usage over time
- RSS memory tracking
- Heap utilization gauge (0-100%)
- Request latency heatmap
- Agent execution time by domain
- Total requests/errors/executions stats

**Import:** `config/grafana/dashboard-performance.json`

### 3. Model & Integration Dashboard
**File:** `dashboard-integrations.json`

Model and external integration metrics:
- Model call success rate gauge
- Model calls by model (timeseries)
- Model call duration with thresholds
- Model calls by domain (pie chart)
- Delivery success rate gauge
- Deliveries by mode (timeseries)
- Delivery response time
- Delivery failures tracking

**Import:** `config/grafana/dashboard-integrations.json`

---

## Setup Instructions

### 1. Configure Prometheus Data Source

In Grafana, add a Prometheus data source:

```
Name: Life Coach Prometheus
Type: Prometheus
URL: http://localhost:9090  # Your Prometheus URL
Scrape interval: 15s
```

### 2. Import Dashboards

**Option A: Via UI**
1. Go to Grafana → Create → Import
2. Upload JSON file or paste JSON content
3. Select Prometheus data source
4. Click Import

**Option B: Via API**

```bash
# Import overview dashboard
curl -X POST \
  http://admin:admin@localhost:3000/api/dashboards/db \
  -H 'Content-Type: application/json' \
  -d @config/grafana/dashboard-overview.json

# Import performance dashboard
curl -X POST \
  http://admin:admin@localhost:3000/api/dashboards/db \
  -H 'Content-Type: application/json' \
  -d @config/grafana/dashboard-performance.json

# Import integrations dashboard
curl -X POST \
  http://admin:admin@localhost:3000/api/dashboards/db \
  -H 'Content-Type: application/json' \
  -d @config/grafana/dashboard-integrations.json
```

### 3. Configure Prometheus Scraping

Add to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'lifecoach'
    static_configs:
      - targets: ['localhost:8787']
    metrics_path: '/metrics/prometheus'
    scrape_interval: 15s
```

---

## Dashboard Variables

All dashboards use these default settings:
- **Refresh:** 30 seconds
- **Timezone:** Browser local time
- **Schema Version:** 36 (Grafana 8.0+)

---

## Metric Reference

### Core Metrics Used

| Metric | Type | Description |
|--------|------|-------------|
| `lifecoach_requests_total` | Counter | Total requests |
| `lifecoach_errors_total` | Counter | Total errors |
| `lifecoach_request_latency_*` | Histogram | Latency distribution |
| `lifecoach_memory_heap_used_bytes` | Gauge | Heap memory |
| `lifecoach_memory_rss_bytes` | Gauge | RSS memory |
| `lifecoach_cache_hit_ratio` | Gauge | Cache hit ratio |
| `lifecoach_model_calls_total` | Counter | Model calls |
| `lifecoach_model_call_duration_ms` | Gauge | Model latency |
| `lifecoach_deliveries_total` | Counter | Delivery attempts |
| `lifecoach_agent_executions_total` | Counter | Agent executions |

---

## Customization

### Changing Thresholds

Edit dashboard JSON and modify `fieldConfig.defaults.thresholds`:

```json
"thresholds": {
  "steps": [
    { "color": "green", "value": 0 },
    { "color": "yellow", "value": 500 },
    { "color": "red", "value": 1000 }
  ]
}
```

### Adding New Panels

1. Export working dashboard from Grafana
2. Copy panel JSON
3. Update `gridPos` to avoid overlap
4. Import updated JSON

---

## Troubleshooting

### No Data Showing

1. Verify Prometheus is scraping: `curl localhost:8787/metrics/prometheus`
2. Check Prometheus targets: Status → Targets
3. Verify data source connection in Grafana

### Slow Dashboard Loading

1. Increase refresh interval (30s → 1m)
2. Reduce time range (Last 6 hours → Last 1 hour)
3. Add recording rules for complex queries

---

## Version History

- **v1.0.0** (Day 73): Initial dashboard templates
  - Overview dashboard
  - Performance & Memory dashboard
  - Model & Integration dashboard

---

*Part of Life Coach AI Observability System*
