# Life Coach AI - Load Testing

Performance and load testing suite for Life Coach AI using Artillery.

## Prerequisites

```bash
# Install Artillery globally
npm install -g artillery

# Or use local installation
cd config/load-testing
npm install
```

## Quick Start

```bash
# Run basic load test
artillery run config/load-testing/basic-load-test.yml

# Generate HTML report
artillery run config/load-testing/basic-load-test.yml -o results.json
artillery report results.json
```

## Test Types

| Test | Purpose | Duration | Peak RPS |
|------|---------|----------|----------|
| **basic-load-test** | General API validation | 5 min | 20 |
| **chat-load-test** | Coaching conversations | 3 min | 5 |
| **health-load-test** | Health endpoint stress | 1 min | 50 |
| **stress-test** | Find breaking point | 3 min | 200 |
| **spike-test** | Sudden traffic bursts | 4 min | 150 |
| **soak-test** | Memory leak detection | 30 min | 10 |

## Running Tests

### Basic Load Test
Tests all endpoints with realistic traffic pattern:
```bash
artillery run config/load-testing/basic-load-test.yml
```

### Chat Load Test
Simulates realistic coaching conversations:
```bash
artillery run config/load-testing/chat-load-test.yml
```

### Health Check Load Test
High-frequency health checks (monitoring simulation):
```bash
artillery run config/load-testing/health-load-test.yml
```

### Stress Test
Progressively increases load to find limits:
```bash
artillery run config/load-testing/stress-test.yml
```

### Spike Test
Simulates sudden traffic spikes:
```bash
artillery run config/load-testing/spike-test.yml
```

### Soak Test (Long-running)
Detects memory leaks and resource exhaustion:
```bash
artillery run config/load-testing/soak-test.yml
```

## Performance Targets

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| P50 latency | < 200ms | 500ms | 1000ms |
| P95 latency | < 500ms | 1000ms | 2000ms |
| P99 latency | < 1000ms | 2000ms | 5000ms |
| Error rate | < 0.1% | 1% | 5% |
| Throughput | > 100 RPS | 50 RPS | 20 RPS |

## Test Scenarios

### 1. Basic Load Test
```
Phase 1: Warm up (1 min, 5 RPS)
Phase 2: Ramp up (2 min, 10 RPS)
Phase 3: Peak (1 min, 20 RPS)
Phase 4: Cool down (1 min, 5 RPS)
```

### 2. Stress Test
```
Phase 1: Baseline (30s, 10 RPS)
Phase 2: Moderate (30s, 25 RPS)
Phase 3: High (30s, 50 RPS)
Phase 4: Very high (30s, 100 RPS)
Phase 5: Extreme (30s, 200 RPS)
Phase 6: Recovery (30s, 50 RPS)
```

### 3. Spike Test
```
Phase 1: Normal (1 min, 5 RPS)
Phase 2: Spike (10s, 100 RPS)
Phase 3: Recovery (1 min, 5 RPS)
Phase 4: Second spike (15s, 150 RPS)
Phase 5: Final recovery (1 min, 5 RPS)
```

## Analyzing Results

### Generate Report
```bash
# Run test with JSON output
artillery run test.yml -o results.json

# Generate HTML report
artillery report results.json -o report.html
```

### Key Metrics to Watch

1. **Latency percentiles** - P50, P95, P99
2. **Error rate** - Should stay below 0.1%
3. **Throughput** - Requests per second
4. **Codes** - HTTP response code distribution

### Sample Output
```
Summary report @ 18:30:00(+0000)
  Scenarios launched:  1000
  Scenarios completed: 998
  Requests completed:  2994
  Mean response time:  145.3ms
  Response time (p50): 120ms
  Response time (p95): 280ms
  Response time (p99): 450ms
  RPS sent:           49.9
  Errors:             2 (0.07%)
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TARGET_URL` | API base URL | `http://localhost:8787` |
| `LOAD_TEST_DURATION` | Override test duration | varies |
| `LOAD_TEST_RATE` | Override arrival rate | varies |

## CI/CD Integration

### GitHub Actions
```yaml
- name: Run load tests
  run: |
    npm install -g artillery
    artillery run config/load-testing/basic-load-test.yml
```

### Performance Gate
```yaml
- name: Performance gate
  run: |
    artillery run config/load-testing/basic-load-test.yml -o results.json
    # Check if P95 is under 1000ms
    node -e "const r=require('./results.json'); process.exit(r.aggregate.latency.p95 > 1000 ? 1 : 0)"
```

## Troubleshooting

### High Error Rate
1. Check API logs for errors
2. Verify database connections
3. Check rate limiting configuration
4. Review memory usage

### High Latency
1. Check database query performance
2. Review model adapter calls
3. Check Redis cache hit rate
4. Consider scaling horizontally

### Memory Growth
1. Run soak test
2. Monitor `/metrics/memory` endpoint
3. Check for connection leaks
4. Review session cleanup

## Best Practices

1. **Run tests in isolation** - Don't run on production database
2. **Warm up first** - Allow JIT optimization
3. **Monitor during tests** - Watch metrics dashboard
4. **Compare baselines** - Track performance over time
5. **Test after changes** - Catch regressions early

## File Structure

```
config/load-testing/
├── package.json            # Artillery dependencies
├── README.md               # This file
├── basic-load-test.yml     # General API test
├── chat-load-test.yml      # Chat endpoint test
├── health-load-test.yml    # Health check test
├── stress-test.yml         # Breaking point test
├── spike-test.yml          # Traffic spike test
└── soak-test.yml           # Long-running test
```
