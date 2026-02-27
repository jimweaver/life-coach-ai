# Life Coach Skill for OpenClaw

Call Life Coach AI APIs from any OpenClaw agent.

## Usage

```javascript
const lifeCoach = require('./skills/life-coach');

// Get coaching advice
const response = await lifeCoach.chat({
  userId: 'user-uuid',
  message: '我想轉職做工程師'
});

// Get user profile
const profile = await lifeCoach.getProfile('user-uuid');

// Set a goal
await lifeCoach.setGoal('user-uuid', {
  domain: 'career',
  title: '轉職軟件工程師',
  target_date: '2026-06-01'
});
```

## API

### `chat({ userId, message, sessionId? })`
Get coaching advice from Life Coach AI.

### `getProfile(userId)`
Retrieve user profile and history.

### `setGoal(userId, goalData)`
Create or update a goal.

### `getGoals(userId)`
List all user goals.

### `runMonitorCycle()`
Trigger KBI monitoring for all users.

### `runMorningCycle()`
Trigger morning interventions.

### `getMetrics()`
Get system health and metrics.

## Configuration

Set in `.env` or OpenClaw config:

```bash
LIFE_COACH_API_URL=http://localhost:8787
LIFE_COACH_API_KEY=optional-api-key
```
