#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const queueKey = `lifecoach:test:dead-letter-replay:${Date.now()}:${process.pid}`;

  process.env.CRON_DELIVERY_MODE = 'redis';
  process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;

  // Keep this test independent from rate-limit tuning in other suites.
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  const db = new DatabaseStorageManager();
  const userId = uuidv4();

  try {
    await db.createUserProfile(userId, {
      name: 'dead-letter-replay-test-user',
      created_at: new Date().toISOString()
    });

    const deadLetterEnvelope = {
      kind: 'systemEvent',
      text: 'dead letter replay test message',
      source: 'test-suite',
      event_type: 'scheduled_intervention',
      cycle: 'monitor',
      severity: 'warning',
      user_id: userId,
      timestamp: new Date().toISOString(),
      metadata: { from: 'test' }
    };

    const eventId = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId,
      channel: 'cron-event',
      source: 'test-suite',
      payload: deadLetterEnvelope
    });

    await db.markOutboundEventDeadLetter(eventId, 'seed_dead_letter', { seeded: true });

    const pendingEventId = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId,
      channel: 'cron-event',
      source: 'test-suite',
      payload: deadLetterEnvelope
    });

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      // 1) Happy path replay from dead-letter -> dispatched
      const replayRes = await fetch(`${base}/jobs/dead-letter/${eventId}/replay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxRetries: 0 })
      });

      assert(replayRes.status === 200, `replay expected 200, got ${replayRes.status}`);
      const replayBody = await replayRes.json();
      assert(replayBody.ok === true, 'replay response should have ok=true');
      assert(replayBody.status === 'dispatched', `expected dispatched, got ${replayBody.status}`);

      const replayedRow = await db.getOutboundEventById(eventId);
      assert(replayedRow.status === 'dispatched', `event status should be dispatched, got ${replayedRow.status}`);

      const queueDepth = await db.redis.llen(queueKey);
      assert(queueDepth >= 1, `expected queue depth >=1 after replay, got ${queueDepth}`);

      // 2) Non dead-letter event should be rejected with 400
      const notDeadRes = await fetch(`${base}/jobs/dead-letter/${pendingEventId}/replay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });

      assert(notDeadRes.status === 400, `non dead-letter replay expected 400, got ${notDeadRes.status}`);
      const notDeadBody = await notDeadRes.json();
      assert(notDeadBody.reason === 'not_dead_letter', `expected reason not_dead_letter, got ${notDeadBody.reason}`);

      // 3) Missing event should return 404
      const missingId = uuidv4();
      const missingRes = await fetch(`${base}/jobs/dead-letter/${missingId}/replay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });

      assert(missingRes.status === 404, `missing event replay expected 404, got ${missingRes.status}`);

      // 4) Invalid UUID should return 400 validation error
      const badIdRes = await fetch(`${base}/jobs/dead-letter/not-a-uuid/replay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      assert(badIdRes.status === 400, `invalid eventId expected 400, got ${badIdRes.status}`);

      console.log('✅ dead-letter replay endpoint test passed');
    } finally {
      await shutdown();
    }
  } finally {
    await db.redis.del(queueKey).catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ dead-letter replay endpoint test failed:', err.message);
  process.exit(1);
});
