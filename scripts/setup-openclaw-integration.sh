#!/bin/bash

# Life Coach OpenClaw Integration Setup Script
# Run this to fully integrate Life Coach into OpenClaw

set -e

echo "🚀 Setting up Life Coach in OpenClaw..."

# 1. Check Life Coach API is running
echo "📡 Checking Life Coach API..."
if ! curl -s http://localhost:8787/health > /dev/null; then
  echo "❌ Life Coach API not running at http://localhost:8787"
  echo "   Start it first: cd /Users/tj/.openclaw/workspace-life-coach-v2 && npm run deploy:up"
  exit 1
fi
echo "✅ Life Coach API is running"

# 2. Create skill symlink
echo "🔗 Creating OpenClaw skill link..."
SKILL_DIR="/usr/local/lib/node_modules/openclaw/skills/life-coach"
mkdir -p "$SKILL_DIR"
ln -sf /Users/tj/.openclaw/workspace-life-coach-v2/skill-wrapper/life-coach-skill.js "$SKILL_DIR/index.js"
echo "✅ Skill linked"

# 3. Create agent directory
echo "🤖 Creating Life Coach agent..."
AGENT_DIR="/Users/tj/.openclaw/agents/lifecoach/agent"
mkdir -p "$AGENT_DIR"

cat > "$AGENT_DIR/SKILL.md" << 'EOF'
# Life Coach Agent

You are the Life Coach AI agent.

## Capabilities
- Provide career, health, finance, skill, relationship, decision coaching
- Track user goals and progress
- Monitor Key Behavioral Indicators (KBI)
- Deliver morning interventions

## Tools Available
- life_coach_chat - Get coaching advice
- life_coach_get_profile - View user data
- life_coach_set_goal - Create goals
- life_coach_monitor - Check KBI status

## Workspace
- Life Coach API: http://localhost:8787
- Database: life_coach (PostgreSQL)
- Redis: localhost:6379

## Response Style
- Empathetic and supportive
- Actionable recommendations
- Domain-specific expertise
EOF

echo "✅ Agent created"

# 4. Register in OpenClaw config
echo "⚙️  Registering in OpenClaw config..."
CONFIG_FILE="$HOME/.openclaw/openclaw.json"

# Backup config
cp "$CONFIG_FILE" "$CONFIG_FILE.backup.$(date +%s)"

echo "✅ Config backed up"

# 5. Setup cron jobs
echo "⏰ Setting up cron jobs..."

# Add morning intervention if not exists
if ! grep -q "life-coach-morning" "$CONFIG_FILE" 2>/dev/null; then
  echo "   Add to your OpenClaw config:"
  echo "   - Morning intervention: 0 9 * * *"
  echo "   - Monitor cycle: 0 */4 * * *"
fi

echo "✅ Setup instructions ready"

# 6. Summary
echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Add Telegram bot token to ~/.openclaw/openclaw.json"
echo "2. Add agent config to ~/.openclaw/openclaw.json (see docs/OPENCLAW_INTEGRATION.md)"
echo "3. Restart OpenClaw: openclaw gateway restart"
echo "4. Test: Message your Life Coach bot on Telegram"
echo ""
echo "📚 Documentation:"
echo "   - Telegram setup: docs/TELEGRAM_BOT_SETUP.md"
echo "   - Cron jobs: docs/CRON_SETUP.md"
echo "   - Tools: docs/TOOLS_SETUP.md"
echo "   - Full guide: docs/OPENCLAW_INTEGRATION.md"
