#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const CronEventDelivery = require('./core/cron-event-delivery');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const db = new DatabaseStorageManager();
  const queueKey = `lifecoach:test:cron-delivery:${Date.now()}:${process.pid}`;

  try {
    const delivery = new CronEventDelivery({
      mode: 'redis',
      redis: db.redis,
      redisListKey: queueKey
    });

    const envelope = delivery.buildEnvelope({
      userId: uuidv4(),
      cycle: 'monitor',
      message: 'test monitor message',
      severity: 'warning',
      metadata: { sample: true }
    });

    const sent = await delivery.deliver(envelope);
    assert(sent.delivered === true, 'expected redis delivery success');

    const firstLen = await db.redis.llen(queueKey);
    assert(firstLen === 1, `expected queue len=1, got ${firstLen}`);

    const entries = await db.redis.lrange(queueKey, 0, -1);
    const parsed = JSON.parse(entries[0]);
    assert(parsed.kind === 'systemEvent', 'event kind mismatch');
    assert(parsed.source === 'life-coach-scheduler', 'event source mismatch');

    const batch = await delivery.deliverBatch([
      delivery.buildEnvelope({
        userId: uuidv4(),
        cycle: 'morning',
        message: 'morning message A'
      }),
      delivery.buildEnvelope({
        userId: uuidv4(),
        cycle: 'morning',
        message: 'morning message B'
      })
    ]);

    assert(batch.delivered === 2, `expected batch delivered=2, got ${batch.delivered}`);

    const totalLen = await db.redis.llen(queueKey);
    assert(totalLen === 3, `expected queue len=3, got ${totalLen}`);

    const none = new CronEventDelivery({ mode: 'none' });
    const skipped = await none.deliver(envelope);
    assert(skipped.delivered === false, 'none mode should skip delivery');

    console.log('✅ cron delivery test passed');
  } finally {
    await db.redis.del(queueKey).catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ cron delivery test failed:', err.message);
  process.exit(1);
});
