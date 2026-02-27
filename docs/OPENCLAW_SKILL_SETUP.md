# Life Coach OpenClaw Skill

## Installation

```bash
# Create skill directory
mkdir -p /usr/local/lib/node_modules/openclaw/skills/life-coach
cd /usr/local/lib/node_modules/openclaw/skills/life-coach

# Link to Life Coach API
ln -s /Users/tj/.openclaw/workspace-life-coach-v2/skill-wrapper/life-coach-skill.js index.js
```

## Configuration

Add to `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "life-coach": {
      "enabled": true,
      "apiUrl": "http://localhost:8787",
      "apiKey": null
    }
  }
}
```

## Available as Tool

Any agent can now call:
- `life-coach.chat()` - Get coaching
- `life-coach.getProfile()` - View user data
- `life-coach.runMonitorCycle()` - Trigger monitoring
- `life-coach.getMetrics()` - System health

## Commands

```bash
/life-coach chat "I want to change careers"
/life-coach profile @user-id
/life-coach goals @user-id
/life-coach metrics
```
