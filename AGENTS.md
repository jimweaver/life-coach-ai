# AGENTS.md - Life Coach AI Agent Specification (Comprehensive)

## Agent Identity

- **Name:** Life Coach AI
- **ID:** `lifecoach`
- **Role:** Multi-Domain Personal Development Coach + System Orchestrator
- **Workspace:** `/Users/tj/.openclaw/workspace-life-coach-v2/`
- **Emoji:** 🧠
- **Avatar:** 🧠 (brain/growth symbol)

## System Architecture Overview

Life Coach AI is a sophisticated multi-agent coaching platform with 5 layers:

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: User Interface (Telegram @Evelyn_agent_bot)           │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Orchestration (OrchestratorEngine)                    │
│           - Intent classification                               │
│           - Safety check (crisis detection)                     │
│           - Domain routing                                      │
│           - Skill learning detection                            │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Agent Collaboration (14 specialized agents)           │
│           - 6 Domain Agents (career/health/finance/skill/       │
│             relationship/decision)                              │
│           - 4 Shared Service Agents                             │
│           - 4 Supervisory Agents                                │
├─────────────────────────────────────────────────────────────────┤
│  Layer 4: Memory System (STM/MTM/LTM/Vector)                    │
│           - Redis (Short-Term Memory)                           │
│           - PostgreSQL (Medium-Term Memory)                     │
│           - Object Store (Long-Term Memory)                     │
│           - Qdrant (Vector Memory)                              │
├─────────────────────────────────────────────────────────────────┤
│  Layer 5: Infrastructure (API, Scheduler, Metrics)              │
│           - Express API Server                                  │
│           - SchedulerRunner (cron jobs)                         │
│           - Prometheus metrics                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## The 14 Specialized Agents

### Domain Expert Agents (6)

| Agent ID | Domain | Purpose | Trigger Keywords |
|----------|--------|---------|------------------|
| `career-coach` | Career | Job transitions, skill building, promotions | 工作, 職涯, 轉職, 升遷, career, job |
| `health-coach` | Health | Stress, sleep, sustainable habits | 健康, 壓力, 焦慮, 睡眠, health, stress |
| `finance-coach` | Finance | Budgeting, planning, risk management | 財務, 錢, 投資, 預算, finance, money |
| `skill-coach` | Skills | Learning paths, certifications | 技能, 學習, 課程, 證書, skill, portfolio |
| `relationship-coach` | Relationships | Communication, conflict resolution | 關係, 溝通, 同事, 伴侶, relationship |
| `decision-coach` | Decision-making | Option evaluation, clarity | 決定, 選擇, 兩難, 取捨, decision |

**Each domain agent provides:**
- Domain-specific analysis
- 3 actionable recommendations
- Constraints and risks
- Confidence score (0.7-0.85)

### Shared Service Agents (4)

| Agent ID | Purpose | When Activated |
|----------|---------|----------------|
| `data-collector` | Web search, knowledge retrieval | Every domain request for citations |
| `context-memory` | User profile, conversation history | Every request |
| `progress-tracker` | KBI monitoring, goal tracking | Background scheduler |
| `conflict-resolver` | Resolve conflicting advice | Multi-domain scenarios |

### Supervisory Agents (4)

| Agent ID | Purpose | Critical Role |
|----------|---------|---------------|
| `safety-guardian` | Crisis detection | **EMERGENCY SHORT-CIRCUIT** |
| `kbi-monitor` | Key Behavioral Indicator tracking | Background monitoring |
| `intervention` | Proactive outreach | Morning/monitor cycles |
| `ethics-guardian` | Advice quality assurance | All outputs |

---

## Processing Modes

### Mode 1: Emergency (Highest Priority)
```
Trigger: Crisis keywords detected (urgency >= 5)
Path:   User Input → Safety Check → EMERGENCY_RESPONSE
Skip:   All domain agents, all normal processing
Output: Immediate crisis resources
Time:   < 1 second
```

**Crisis Keywords (Critical):**
- 自殺, 唔想活, 自殘, 殺死, 結束生命, suicide, kill myself

**Response:**
```
我聽到你而家非常辛苦。你嘅安全最重要。
如果你有即時危險，請即刻打 999 或去最近急症室。
你唔需要一個人面對。
```

### Mode 2: Skill Learning Detection
```
Trigger: User mentions creating a skill
Path:   User Input → SkillLearning.analyze() → skill_learning mode
Output: Skill analysis report
Time:   < 2 seconds
```

### Mode 3: Single-Domain Coaching
```
Trigger: Intent classification returns 1 domain
Path:   User Input → Intent Classify → Domain Agent → Data Collector
        → Compose Response → Persist
Time:   < 3 seconds
```

### Mode 4: Multi-Domain Coaching
```
Trigger: Intent classification returns 2+ domains
Path:   User Input → Intent Classify → Parallel Domain Agents
        → Conflict Resolver → Compose Response → Persist
Time:   < 8 seconds
```

---

## Memory System (4-Layer)

### Layer 1: Short-Term Memory (Redis)
- **TTL:** 24 hours
- **Storage:** Session context, conversation history (last 20 messages)
- **Keys:** `session:{user_id}:{session_id}`

### Layer 2: Medium-Term Memory (PostgreSQL)
- **Retention:** 90 days
- **Tables:** behavior_patterns, user_preferences, cyclical_patterns
- **Data:** User goals, KBI metrics, conversation logs

### Layer 3: Long-Term Memory (Object Store)
- **Retention:** Permanent
- **Format:** JSON files
- **Data:** Life trajectory, core values, key milestones

### Layer 4: Vector Memory (Qdrant)
- **Dimension:** 1536 (OpenAI embeddings)
- **Collections:** conversation_embeddings, knowledge_embeddings
- **Use:** Semantic search, similarity matching

---

## API Endpoints Reference

### Core Coaching Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/chat` | POST | Main coaching endpoint - processes all user messages |
| `/profile/{userId}` | GET | Retrieve user profile |
| `/profile/{userId}` | POST | Create/update user profile |
| `/goals/{userId}` | GET | List user goals |
| `/goals/{userId}` | POST | Create/update goal |
| `/kbi/{userId}/{metric}` | GET | Get specific KBI metric |

### Health & System
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Basic health check |
| `/ready` | GET | Production readiness (includes shutdown status) |
| `/health/deep` | GET | Comprehensive diagnostics |
| `/metrics/dashboard` | GET | Unified system metrics |
| `/metrics/alerts` | GET | Active alert evaluation |
| `/metrics/prometheus` | GET | Prometheus export format |

### Scheduler & Jobs
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/jobs/run-monitor-cycle` | POST | Trigger KBI monitoring |
| `/jobs/run-morning-cycle` | POST | Trigger morning interventions |
| `/jobs/run-retry-cycle` | POST | Retry failed deliveries |
| `/jobs/dead-letter` | GET | View dead-letter events |
| `/jobs/dead-letter/{id}/replay` | POST | Replay dead-letter event |

### Deploy & Operations
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/jobs/deploy-events` | GET | Deploy event analytics |
| `/jobs/deploy-events/dashboard` | GET | Deploy dashboard |
| `/jobs/canary/drift` | GET | Canary profile drift detection |
| `/jobs/delivery/alerts` | GET | Delivery alert evaluation |

---

## Request/Response Flow

### Typical Chat Request
```javascript
// POST /chat
{
  "userId": "uuid-string",
  "message": "I want to improve my career",
  "sessionId": "optional-existing-session"
}

// Response
{
  "session_id": "uuid",
  "mode": "single-domain" | "multi-domain" | "emergency" | "skill_learning",
  "intent": {
    "primary_domain": "career",
    "domains": ["career"],
    "urgency": 2,
    "confidence": 0.8
  },
  "risk_level": "NONE" | "HIGH" | "CRITICAL",
  "conflicts": [...], // if multi-domain
  "output": "formatted response with domain headers",
  "elapsed_ms": 1450
}
```

### Response Format
```
【CAREER | model: kimi-k2p5】
你呢個問題核心係職涯方向與轉型策略。

建議：
1. 先定義目標職位（JD）同關鍵能力要求
2. 做技能差距盤點，拆成 30/60/90 日學習計劃
3. 建立一份可展示成果（portfolio）提升轉職成功率

來源參考（可信度 80%）：
1) 職涯轉型指南 (https://example.com)

Confidence: 0.80
```

---

## Environment Configuration

### Required Environment Variables
```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/life_coach
REDIS_HOST=localhost
REDIS_PORT=6379

# External APIs
OPENAI_API_KEY=sk-...
BRAVE_API_KEY=...

# API
PORT=8787
NODE_ENV=production

# Model Routing
DOMAIN_MODEL_ADAPTER_MODE=auto  # off | auto | force

# Rate Limiting
RATE_LIMIT_BACKEND=redis  # redis | memory
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000

# Cron Delivery
CRON_EVENT_DELIVERY_MODE=redis  # none | redis | webhook
CRON_EVENT_REDIS_LIST_KEY=openclaw:cron-events

# Scheduler
SCHEDULER_MONITOR_CYCLE_INTERVAL_MS=14400000  # 4 hours
SCHEDULER_MORNING_CYCLE_HOUR=9
SCHEDULER_MORNING_CYCLE_MINUTE=0
SCHEDULER_MORNING_CYCLE_TIMEZONE=America/Los_Angeles
```

---

## Scheduler System

### Monitor Cycle (Every 4 hours)
1. Scan all users
2. Evaluate KBI metrics
3. Trigger interventions if thresholds breached
4. Queue outbound events

### Morning Cycle (Daily 9 AM)
1. Generate personalized morning check-in
2. Review active goals
3. Send intervention messages
4. Update user engagement metrics

### Retry Cycle (Manual/Automated)
1. Scan failed outbox events
2. Attempt redelivery with exponential backoff
3. Dead-letter after max retries (default: 3)

---

## Safety Protocols

### Crisis Detection Levels

**Level CRITICAL (Immediate):**
- Keywords: 自殺, 唔想活, 自殘, 殺死, 結束生命, suicide, kill myself
- Action: Emergency short-circuit, bypass all processing
- Response: Crisis resources + escalation

**Level HIGH (Warning):**
- Keywords: 絕望, 崩潰, 活唔落去, 冇希望, hopeless
- Action: Log warning, continue with care
- Response: Standard coaching + gentle check-in

**Level NONE (Normal):**
- No crisis keywords detected
- Action: Normal processing flow

### Safety Response Template
```javascript
{
  passed: false,
  risk_level: 'CRITICAL',
  action: 'EMERGENCY_RESPONSE',
  safe_output: '我聽到你而家非常辛苦...'
}
```

---

## Key File Locations

| File | Path | Purpose |
|------|------|---------|
| API Server | `core/api-server.js` | Express server, all endpoints |
| Orchestrator | `core/orchestrator-engine.js` | Main processing logic |
| Domain Agents | `core/domain-agents.js` | Domain-specific processing |
| Database | `core/storage/database-storage.js` | All DB operations |
| Scheduler | `core/scheduler-runner.js` | Cron job runner |
| Agent Configs | `agents/*/config.yml` | Individual agent settings |

---

## Operational Procedures

### Starting the System
```bash
# Check prerequisites
npm run deploy:preflight

# Start API
npm run deploy:up

# Or with smoke test
npm run deploy:smoke
```

### Checking Health
```bash
# Basic health
curl http://localhost:8787/health

# Deep health
curl http://localhost:8787/health/deep

# Metrics dashboard
curl http://localhost:8787/metrics/dashboard
```

### Running Tests
```bash
# Core tests
npm test

# Specific test suites
npm run test:db
npm run test:agents
npm run test:orchestrator
npm run test:scheduler
npm run test:metrics
npm run test:delivery
npm run test:e2e
```

### Troubleshooting

**API not responding:**
```bash
# Check if running
ps aux | grep "api-server"

# Check logs
npm run logs

# Restart
npm run deploy:up
```

**Database connection issues:**
```bash
# Check PostgreSQL
brew services list | grep postgresql

# Check Redis
redis-cli ping
```

**High latency:**
- Check `/metrics/latency` endpoint
- Review slow queries in `/metrics/queries`
- Check cache hit rate in `/metrics/cache`

---

## Performance Targets

| Metric | Target | Critical |
|--------|--------|----------|
| P50 latency | < 200ms | > 500ms |
| P95 latency | < 500ms | > 1000ms |
| P99 latency | < 1000ms | > 2000ms |
| Error rate | < 0.1% | > 1% |
| Cache hit rate | > 80% | < 50% |
| DB query avg | < 50ms | > 200ms |

---

## Version Information

- **Current:** v1.0
- **Features:** 92
- **Release Date:** 2026-02-27
- **GitHub:** https://github.com/jimweaver/life-coach-ai
- **License:** MIT
