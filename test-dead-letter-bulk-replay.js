#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const queueKey = `lifecoach:test:dead-letter-bulk:${Date.now()}:${process.pid}`;

  process.env.CRON_DELIVERY_MODE = 'redis';
  process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;

  // keep independent from other suites
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  const db = new DatabaseStorageManager();
  const userA = uuidv4();
  const userB = uuidv4();

  try {
    await db.createUserProfile(userA, { name: 'bulk-replay-a' });
    await db.createUserProfile(userB, { name: 'bulk-replay-b' });

    const mkEnvelope = (userId, cycle) => ({
      kind: 'systemEvent',
      text: `dead-letter-${cycle}`,
      source: 'test-suite',
      event_type: 'scheduled_intervention',
      cycle,
      severity: cycle === 'monitor' ? 'warning' : 'info',
      user_id: userId,
      timestamp: new Date().toISOString(),
      metadata: { seed: true }
    });

    const m1 = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId: userA,
      source: 'test-suite',
      payload: mkEnvelope(userA, 'monitor')
    });
    const m2 = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.monitor',
      userId: userA,
      source: 'test-suite',
      payload: mkEnvelope(userA, 'monitor')
    });
    const morning = await db.enqueueOutboundEvent({
      eventType: 'scheduled_intervention.morning',
      userId: userB,
      source: 'test-suite',
      payload: mkEnvelope(userB, 'morning')
    });

    await db.markOutboundEventDeadLetter(m1, 'seed');
    await db.markOutboundEventDeadLetter(m2, 'seed');
    await db.markOutboundEventDeadLetter(morning, 'seed');

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const listRes = await fetch(`${base}/jobs/dead-letter?limit=20&eventType=scheduled_intervention.monitor`);
      assert(listRes.status === 200, `dead-letter list expected 200, got ${listRes.status}`);
      const listBody = await listRes.json();
      assert(listBody.count >= 2, `expected at least 2 monitor dead-letters, got ${listBody.count}`);

      const bulkRes = await fetch(`${base}/jobs/dead-letter/replay-bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventType: 'scheduled_intervention.monitor',
          userId: userA,
          limit: 10,
          maxRetries: 0
        })
      });

      assert(bulkRes.status === 200, `bulk replay expected 200, got ${bulkRes.status}`);
      const bulkBody = await bulkRes.json();

      assert(bulkBody.ok === true, 'bulk replay response should include ok=true');
      assert(bulkBody.result.processed >= 2, `expected processed>=2, got ${bulkBody.result.processed}`);
      assert(bulkBody.result.dispatched >= 2, `expected dispatched>=2, got ${bulkBody.result.dispatched}`);

      const rowM1 = await db.getOutboundEventById(m1);
      const rowM2 = await db.getOutboundEventById(m2);
      const rowMorning = await db.getOutboundEventById(morning);

      assert(rowM1.status === 'dispatched', `m1 should be dispatched, got ${rowM1.status}`);
      assert(rowM2.status === 'dispatched', `m2 should be dispatched, got ${rowM2.status}`);
      assert(rowMorning.status === 'dead_letter', `morning should remain dead_letter, got ${rowMorning.status}`);

      const queueDepth = await db.redis.llen(queueKey);
      assert(queueDepth >= 2, `expected queue depth >=2, got ${queueDepth}`);

      const badReq = await fetch(`${base}/jobs/dead-letter/replay-bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'not-a-uuid' })
      });
      assert(badReq.status === 400, `invalid userId should return 400, got ${badReq.status}`);

      console.log('✅ dead-letter bulk replay test passed');
    } finally {
      await shutdown();
    }
  } finally {
    await db.redis.del(queueKey).catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ dead-letter bulk replay test failed:', err.message);
  process.exit(1);
});
