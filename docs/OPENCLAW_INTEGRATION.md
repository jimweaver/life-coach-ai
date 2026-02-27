# Life Coach OpenClaw Integration Guide

Complete guide to integrating Life Coach AI into OpenClaw ecosystem.

## Overview

After integration, Life Coach becomes:
- ✅ An **OpenClaw skill** callable by any agent
- ✅ A **Telegram bot** users can message directly
- ✅ **Cron jobs** for scheduled interventions
- ✅ **Tools** other agents can invoke

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                      │
├─────────────────────────────────────────────────────────┤
│  Channels      │  Agents        │  Skills    │  Cron    │
│  ─────────     │  ───────       │  ─────     │  ────    │
│  Telegram      │  Peter         │  life-     │  Morning │
│    └──@bot     │    (main)      │    coach   │    9 AM  │
│                │  Bill Gates    │            │  Monitor │
│                │    (strategy)  │            │    4hrs  │
│                │  Life Coach ◄──┼────────────┼──────────┤
│                │    (coaching)  │            │          │
└────────────────┴────────────────┴────────────┴──────────┘
                           │
                           ▼
                ┌───────────────────┐
                │  Life Coach API   │
                │  localhost:8787   │
                └───────────────────┘
```

---

## Quick Setup

### Step 1: Run Setup Script

```bash
cd /Users/tj/.openclaw/workspace-life-coach-v2
./scripts/setup-openclaw-integration.sh
```

### Step 2: Add Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) → `/newbot`
2. Save the token
3. Add to `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "telegram": {
      "bots": {
        "lifecoach": {
          "enabled": true,
          "botToken": "YOUR_TOKEN_HERE",
          "dmPolicy": "open"
        }
      }
    }
  }
}
```

### Step 3: Register Agent

Add to `~/.openclaw/openclaw.json` agents list:

```json
{
  "id": "lifecoach",
  "name": "Life Coach AI",
  "workspace": "/Users/tj/.openclaw/workspace-life-coach-v2",
  "agentDir": "/Users/tj/.openclaw/agents/lifecoach/agent",
  "model": "anthropic/claude-opus-4-6",
  "channels": ["telegram:lifecoach"],
  "tools": ["life_coach_chat", "life_coach_get_profile"],
  "subagents": {
    "allowAgents": ["main", "billgates"]
  }
}
```

### Step 4: Add Cron Jobs

```bash
openclaw cron add \
  --name "life-coach-morning" \
  --schedule "0 9 * * *" \
  --url "http://localhost:8787/jobs/run-morning-cycle" \
  --method POST

openclaw cron add \
  --name "life-coach-monitor" \
  --schedule "0 */4 * * *" \
  --url "http://localhost:8787/jobs/run-monitor-cycle" \
  --method POST
```

### Step 5: Restart OpenClaw

```bash
openclaw gateway restart
```

---

## Usage Scenarios

### 1. User Messages Life Coach Bot

**Flow:**
1. User: `@lifecoach_ai_bot 我想轉職`
2. Telegram → OpenClaw Gateway
3. Routed to Life Coach agent
4. Agent calls `/chat` endpoint
5. Response sent back to Telegram

### 2. Peter Spawns Life Coach

**Flow:**
1. You: "Ask Life Coach about my career"
2. Peter spawns Life Coach sub-agent
3. Life Coach calls own API
4. Returns structured coaching
5. Peter presents to you

### 3. Scheduled Morning Intervention

**Flow:**
1. Cron triggers at 9 AM
2. Calls `/jobs/run-morning-cycle`
3. Life Coach generates interventions
4. Delivered via Telegram to users

### 4. Bill Gates Uses Life Coach Tool

**Flow:**
1. Bill Gates needs user wellbeing data
2. Calls `tools.life_coach_get_profile(userId)`
3. Life Coach returns user data
4. Bill Gates uses in strategic planning

---

## Configuration Reference

### Environment Variables

```bash
# Life Coach API
LIFE_COACH_API_URL=http://localhost:8787
LIFE_COACH_API_KEY=optional-secret

# Cron Delivery
CRON_DELIVERY_MODE=redis          # redis | webhook | none
CRON_EVENT_REDIS_LIST_KEY=lifecoach:events
CRON_EVENT_WEBHOOK_URL=https://api.telegram.org/bot<token>/sendMessage

# Telegram Bot (for Life Coach direct)
LIFE_COACH_TELEGRAM_BOT_TOKEN=xxx
```

### OpenClaw Config Sections

| Section | Purpose | File |
|---------|---------|------|
| `agents.list` | Register Life Coach agent | `~/.openclaw/openclaw.json` |
| `channels.telegram.bots` | Telegram bot config | `~/.openclaw/openclaw.json` |
| `skills.life-coach` | Skill settings | `~/.openclaw/openclaw.json` |
| `cron.jobs` | Scheduled interventions | `~/.openclaw/openclaw.json` |

---

## API Endpoints Used by OpenClaw

| Endpoint | Method | Used By |
|----------|--------|---------|
| `/health` | GET | Health checks |
| `/chat` | POST | Telegram bot, agents |
| `/profile/:id` | GET/POST | Agents, tools |
| `/goals/:id` | GET/POST | Agents, tools |
| `/monitor/:id` | GET | Agents |
| `/intervention/morning/:id` | GET | Agents |
| `/jobs/run-morning-cycle` | POST | Cron |
| `/jobs/run-monitor-cycle` | POST | Cron |
| `/metrics/dashboard` | GET | Monitoring |
| `/metrics/prometheus` | GET | Prometheus |

---

## Troubleshooting

### Telegram bot not responding
```bash
# Check bot is registered
openclaw channels list | grep lifecoach

# Check webhook
openclaw telegram webhook --bot=lifecoach --info
```

### Cron jobs not running
```bash
# Check cron status
openclaw cron list | grep life-coach

# Check logs
openclaw cron logs --job=life-coach-morning
```

### API unreachable
```bash
# Check Life Coach is running
curl http://localhost:8787/health

# Check from OpenClaw container/host
openclaw exec -- curl http://host.docker.internal:8787/health
```

---

## Security Considerations

1. **API Key**: Set `LIFE_COACH_API_KEY` for production
2. **Rate Limiting**: Life Coach has built-in rate limiting
3. **User Isolation**: Each user's data is isolated by `user_id`
4. **Audit Logging**: All coaching interactions are logged

---

## Next Steps

After setup:
1. 📱 Test Telegram bot: Message `@lifecoach_ai_bot`
2. 🔄 Test agent spawning: Ask Peter to involve Life Coach
3. ⏰ Verify cron: Check interventions are delivered
4. 📊 Monitor: View `/metrics/dashboard`

---

*See also:*
- `TELEGRAM_BOT_SETUP.md` - Detailed Telegram setup
- `CRON_SETUP.md` - Cron job configuration
- `TOOLS_SETUP.md` - Tool registration
- `SKILL_SETUP.md` - Skill development
