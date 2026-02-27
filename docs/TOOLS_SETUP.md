# Life Coach Tools for OpenClaw Agents

## Tool Registration

Add to any agent's config or session:

```json
{
  "tools": [
    {
      "name": "life_coach_chat",
      "description": "Get life coaching advice for user questions",
      "endpoint": "http://localhost:8787/chat",
      "method": "POST",
      "parameters": {
        "user_id": {
          "type": "string",
          "description": "User UUID",
          "required": true
        },
        "message": {
          "type": "string",
          "description": "User's question or concern",
          "required": true
        }
      }
    },
    {
      "name": "life_coach_get_profile",
      "description": "Retrieve user profile and coaching history",
      "endpoint": "http://localhost:8787/profile/{user_id}",
      "method": "GET",
      "parameters": {
        "user_id": {
          "type": "string",
          "description": "User UUID",
          "required": true
        }
      }
    },
    {
      "name": "life_coach_set_goal",
      "description": "Create or update a user's goal",
      "endpoint": "http://localhost:8787/goals/{user_id}",
      "method": "POST",
      "parameters": {
        "user_id": {
          "type": "string",
          "required": true
        },
        "domain": {
          "type": "string",
          "enum": ["career", "health", "finance", "skill", "relationship", "decision"],
          "required": true
        },
        "title": {
          "type": "string",
          "required": true
        },
        "target_date": {
          "type": "string",
          "format": "date",
          "required": false
        }
      }
    },
    {
      "name": "life_coach_monitor",
      "description": "Get user's Key Behavioral Indicator status",
      "endpoint": "http://localhost:8787/monitor/{user_id}",
      "method": "GET"
    },
    {
      "name": "life_coach_metrics",
      "description": "Get Life Coach system health and metrics",
      "endpoint": "http://localhost:8787/metrics/dashboard",
      "method": "GET"
    }
  ]
}
```

## Usage Examples

### From Any Agent (Peter, Bill Gates, etc.)

```javascript
// Peter needs to get coaching for a user
const coaching = await tools.life_coach_chat({
  user_id: "user-uuid-here",
  message: "I'm stressed about my career"
});

// Bill Gates wants to see user's progress
const profile = await tools.life_coach_get_profile("user-uuid-here");

// HR agent setting up goals for employee
await tools.life_coach_set_goal({
  user_id: "employee-uuid",
  domain: "career",
  title: "Complete leadership training",
  target_date: "2026-06-01"
});
```

### Natural Language Invocation

Users can say:
> "Ask Life Coach about my career options"

Agent translates to:
```javascript
tools.life_coach_chat({
  user_id: currentUser.id,
  message: "What are my career options?"
});
```

## Tool Auto-Discovery

Life Coach exposes OpenAPI spec:

```bash
curl http://localhost:8787/openapi.json
```

OpenClaw can auto-import:

```bash
openclaw tools import \
  --from http://localhost:8787/openapi.json \
  --namespace life_coach
```

## Permission Control

Restrict which agents can use Life Coach:

```json
{
  "tools": {
    "life_coach_chat": {
      "allowAgents": ["main", "billgates", "pm"],
      "denyAgents": ["public-facing-bot"]
    }
  }
}
```
