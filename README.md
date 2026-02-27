# 🧠 Life Coach AI

A multi-agent personal development platform that provides intelligent coaching across career, health, finance, skills, relationships, and decision-making domains.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-red)](https://redis.io/)

## ✨ Features

### 🎯 Core Coaching
- **Multi-Domain Intelligence**: Career, Health, Finance, Skills, Relationships, Decision-making
- **14 Specialized Agents**: Each domain has dedicated AI agents with expertise
- **Context-Aware**: Maintains conversation history and user profiles
- **Multi-Language**: Supports English, Chinese (Cantonese/Mandarin)

### 🏗️ Architecture
- **Orchestrator Engine**: Intelligent routing and conflict resolution
- **Multi-Tier Memory**: Redis (short-term) + PostgreSQL (medium-term)
- **Safety-First**: Built-in guardrails, rate limiting, emergency detection
- **Model Routing**: Automatic model selection (Claude, GPT, Kimi)

### 📊 Observability
- **13 Metrics Endpoints**: Comprehensive monitoring and alerting
- **Prometheus Export**: Native metrics scraping support
- **Grafana Dashboards**: 3 pre-built dashboards
- **Alert Thresholds**: Configurable warning/critical alerts

### 🔧 Operations
- **Scheduled Interventions**: Morning coaching, KBI monitoring
- **Dead-Letter Handling**: Retry with exponential backoff
- **Canary Deployments**: Automated rollout verification
- **Graceful Shutdown**: Zero-downtime deployments

## 🚀 Quick Start

### Prerequisites

```bash
# macOS
brew install node@22 postgresql@16 redis

# Start services
brew services start postgresql@16
brew services start redis
```

### Installation

```bash
# Clone the repository
git clone https://github.com/jimweaver/life-coach-ai.git
cd life-coach-ai

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Initialize database
npm run db:migrate
```

### Start the API

```bash
# Development mode
npm run dev

# Production mode
npm run deploy:up
```

The API will be available at `http://localhost:8787`

## 📡 API Endpoints

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/chat` | POST | Get coaching advice |
| `/profile/:userId` | GET/POST | User profile management |
| `/goals/:userId` | GET/POST | Goal tracking |
| `/monitor/:userId` | GET | KBI monitoring |
| `/intervention/morning/:userId` | GET | Morning intervention |

### Health & Metrics

| Endpoint | Description |
|----------|-------------|
| `/health` | Basic health check |
| `/health/deep` | Comprehensive diagnostics |
| `/ready` | Production readiness |
| `/metrics/dashboard` | Unified metrics view |
| `/metrics/prometheus` | Prometheus scraping |

### Scheduler

| Endpoint | Description |
|----------|-------------|
| `/jobs/run-monitor-cycle` | Trigger KBI monitoring |
| `/jobs/run-morning-cycle` | Trigger morning interventions |
| `/jobs/dead-letter` | View dead-letter queue |
| `/jobs/delivery/metrics` | Delivery metrics |

## 💬 Example Usage

### Get Coaching Advice

```bash
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "message": "I want to change careers to software engineering"
  }'
```

**Response:**
```json
{
  "mode": "single_domain",
  "domain": "career",
  "response": "【CAREER | model: claude-opus-4-6】\nI understand you're considering a career transition to software engineering...",
  "sources": {
    "citations": [...],
    "confidence": 0.85
  }
}
```

### Get User Profile

```bash
curl http://localhost:8787/profile/550e8400-e29b-41d4-a716-446655440000
```

### Set a Goal

```bash
curl -X POST http://localhost:8787/goals/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "career",
    "title": "Complete software engineering bootcamp",
    "target_date": "2026-06-01"
  }'
```

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      API Layer                           │
│         (Express.js + Guardrails + Rate Limit)          │
├─────────────────────────────────────────────────────────┤
│                   Orchestrator Engine                    │
│    (Intent Classification → Agent Routing → Response)   │
├─────────────────────────────────────────────────────────┤
│                     14 AI Agents                         │
│  Career │ Health │ Finance │ Skills │ Relationship │ ... │
├─────────────────────────────────────────────────────────┤
│                   Data & Memory                          │
│        Redis (STM)         │      PostgreSQL (MTM)      │
│   - Sessions               │   - Users                  │
│   - Rate limits            │   - Conversations          │
│   - Cache                  │   - Goals                  │
│                            │   - Audit logs             │
└─────────────────────────────────────────────────────────┘
```

## 📊 Observability

### Metrics Dashboard

```bash
# View all metrics
curl http://localhost:8787/metrics/dashboard | jq .

# Prometheus format
curl http://localhost:8787/metrics/prometheus

# Active alerts
curl http://localhost:8787/metrics/alerts
```

### Grafana Dashboards

Import from `config/grafana/`:
- `dashboard-overview.json` - Key metrics at a glance
- `dashboard-performance.json` - Memory & performance deep dive
- `dashboard-integrations.json` - Model & delivery metrics

## 🔧 Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/life_coach
REDIS_HOST=localhost
REDIS_PORT=6379

# API
PORT=8787
RATE_LIMIT_BACKEND=redis

# Models
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
MOONSHOT_API_KEY=sk-...

# Cron
CRON_DELIVERY_MODE=redis
CRON_EVENT_REDIS_LIST_KEY=lifecoach:cron-events

# Prometheus
PROMETHEUS_METRICS_PREFIX=lifecoach
```

### Alert Thresholds

```bash
# Latency (ms)
METRICS_ALERT_LATENCY_WARN_MS=1000
METRICS_ALERT_LATENCY_CRITICAL_MS=3000

# Error rate (0-1)
METRICS_ALERT_ERROR_RATE_WARN=0.05
METRICS_ALERT_ERROR_RATE_CRITICAL=0.10

# Memory (0-1)
METRICS_ALERT_MEMORY_WARN=0.80
METRICS_ALERT_MEMORY_CRITICAL=0.95
```

## 🧪 Testing

```bash
# All tests
npm test

# Specific test suites
npm run test:db              # Database connectivity
npm run test:agents          # Agent configurations
npm run test:e2e             # End-to-end flow
npm run test:scheduler       # Scheduler cycles
npm run test:graceful        # Graceful shutdown
npm run test:prometheus      # Prometheus export
npm run test:metrics-alerts  # Alert evaluation
```

## 🔄 OpenClaw Integration

Life Coach can be integrated into OpenClaw as:

1. **Skill**: `tools.life_coach_chat()` callable by any agent
2. **Channel**: Telegram bot `@lifecoach_ai_bot`
3. **Cron**: Scheduled morning interventions
4. **Tools**: `life_coach_get_profile`, `life_coach_set_goal`

See `docs/OPENCLAW_INTEGRATION.md` for setup instructions.

## 📝 Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - System architecture
- [`docs/API.md`](docs/API.md) - API reference
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) - Deployment guide
- [`docs/METRICS_SYSTEM.md`](docs/METRICS_SYSTEM.md) - Observability
- [`docs/OPENCLAW_INTEGRATION.md`](docs/OPENCLAW_INTEGRATION.md) - OpenClaw setup

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- OpenClaw framework for agent orchestration
- Claude, GPT, and Kimi models for AI capabilities
- PostgreSQL and Redis for data infrastructure

---

**Made with ❤️ for personal growth and development**

[GitHub](https://github.com/jimweaver/life-coach-ai) • [Issues](https://github.com/jimweaver/life-coach-ai/issues) • [Discussions](https://github.com/jimweaver/life-coach-ai/discussions)
