# Life Coach Telegram Bot Setup


## 2. Configure in OpenClaw

Edit `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "telegram": {
      "bots": {
        "lifecoach": {
          "name": "Life Coach AI",
          "enabled": true,
          "botToken": "YOUR_BOT_TOKEN_HERE",
          "dmPolicy": "open",
          "groupPolicy": "mention",
          "webhook": {
            "enabled": false,
            "url": null
          }
        }
      }
    }
  }
}
```

## 3. Route Bot to Life Coach Agent

Add to `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "list": [
      {
        "id": "lifecoach",
        "name": "Life Coach AI",
        "workspace": "/Users/tj/.openclaw/workspace-life-coach-v2",
        "agentDir": "/Users/tj/.openclaw/agents/lifecoach/agent",
        "model": "anthropic/claude-opus-4-6",
        "channels": ["telegram:lifecoach"],
        "capabilities": {
          "tools": ["web_search", "file_read", "shell"],
          "skills": ["life-coach"]
        }
      }
    ]
  }
}
```

## 4. Start the Bot

```bash
# Restart OpenClaw gateway to pick up new bot
openclaw gateway restart

# Or if using webhook mode
openclaw telegram webhook --bot=lifecoach --set
```

## 5. User Flow

1. User messages `@lifecoach_ai_bot` on Telegram
2. OpenClaw routes to Life Coach agent
3. Life Coach processes through `/chat` endpoint
4. Response sent back via Telegram

## 6. Commands Available

Users can send:
- Regular messages → Life coaching response
- `/profile` → View their profile
- `/goals` → List goals
- `/monitor` → Check KBI status
- `/help` → Show commands
