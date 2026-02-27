#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const queueKey = `lifecoach:test:dead-letter-safety:${Date.now()}:${process.pid}`;
  const approvalCode = 'SAFE-REPLAY-2026';

  process.env.CRON_DELIVERY_MODE = 'redis';
  process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;

  // isolate from rate-limit interference
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  // safety policy under test
  process.env.DEADLETTER_REPLAY_MAX_LIMIT = '100';
  process.env.DEADLETTER_REPLAY_APPROVAL_THRESHOLD = '2';
  process.env.DEADLETTER_REPLAY_REQUIRE_APPROVAL = 'true';
  process.env.DEADLETTER_REPLAY_APPROVAL_CODE = approvalCode;

  const db = new DatabaseStorageManager();
  const userId = uuidv4();

  try {
    await db.createUserProfile(userId, { name: 'dead-letter-safety-user' });

    const mkEnvelope = () => ({
      kind: 'systemEvent',
      text: 'dead-letter-safety-test',
      source: 'test-suite',
      event_type: 'scheduled_intervention',
      cycle: 'monitor',
      severity: 'warning',
      user_id: userId,
      timestamp: new Date().toISOString(),
      metadata: { seed: true }
    });

    const e1 = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId,
      source: 'test-suite',
      payload: mkEnvelope()
    });

    const e2 = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId,
      source: 'test-suite',
      payload: mkEnvelope()
    });

    await db.markOutboundEventDeadLetter(e1, 'seed-1');
    await db.markOutboundEventDeadLetter(e2, 'seed-2');

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const previewRes = await fetch(`${base}/jobs/dead-letter/replay-bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventType: 'scheduled_intervention.monitor',
          userId,
          limit: 10,
          preview: true
        })
      });

      assert(previewRes.status === 200, `preview expected 200, got ${previewRes.status}`);
      const preview = await previewRes.json();
      assert(preview.preview === true, 'preview flag expected true');
      assert(preview.requires_approval === true, 'preview should mark requires_approval=true for large replay');
      assert(preview.count >= 2, `preview should include >=2 events, got ${preview.count}`);

      const blockedRes = await fetch(`${base}/jobs/dead-letter/replay-bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventType: 'scheduled_intervention.monitor',
          userId,
          limit: 10,
          maxRetries: 0
        })
      });

      assert(blockedRes.status === 403, `expected 403 without approval, got ${blockedRes.status}`);
      const blocked = await blockedRes.json();
      assert(blocked.reason === 'approval_required', `expected approval_required, got ${blocked.reason}`);

      const stillDead1 = await db.getOutboundEventById(e1);
      assert(stillDead1.status === 'dead_letter', `e1 should remain dead_letter after blocked replay, got ${stillDead1.status}`);

      const wrongCodeRes = await fetch(`${base}/jobs/dead-letter/replay-bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventType: 'scheduled_intervention.monitor',
          userId,
          limit: 10,
          maxRetries: 0,
          approve: true,
          approvalCode: 'WRONG-CODE'
        })
      });

      assert(wrongCodeRes.status === 403, `expected 403 with wrong approvalCode, got ${wrongCodeRes.status}`);

      const okRes = await fetch(`${base}/jobs/dead-letter/replay-bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventType: 'scheduled_intervention.monitor',
          userId,
          limit: 10,
          maxRetries: 0,
          approve: true,
          approvalCode
        })
      });

      assert(okRes.status === 200, `expected 200 with approval, got ${okRes.status}`);
      const okBody = await okRes.json();
      assert(okBody.ok === true, 'bulk replay with approval should be ok=true');
      assert(okBody.result.dispatched >= 2, `expected dispatched>=2, got ${okBody.result.dispatched}`);

      const row1 = await db.getOutboundEventById(e1);
      const row2 = await db.getOutboundEventById(e2);
      assert(row1.status === 'dispatched', `e1 should be dispatched, got ${row1.status}`);
      assert(row2.status === 'dispatched', `e2 should be dispatched, got ${row2.status}`);

      const queueDepth = await db.redis.llen(queueKey);
      assert(queueDepth >= 2, `expected queue depth >=2 after successful replay, got ${queueDepth}`);

      console.log('✅ dead-letter safety policy test passed');
    } finally {
      await shutdown();
    }
  } finally {
    await db.redis.del(queueKey).catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ dead-letter safety policy test failed:', err.message);
  process.exit(1);
});
