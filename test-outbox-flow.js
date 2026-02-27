#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const SchedulerRunner = require('./core/scheduler-runner');
const CronEventDelivery = require('./core/cron-event-delivery');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const db = new DatabaseStorageManager();
  const userId = uuidv4();
  const queueKey = `lifecoach:test:outbox:${Date.now()}:${process.pid}`;

  try {
    await db.createUserProfile(userId, {
      name: 'outbox-flow-test-user',
      created_at: new Date().toISOString()
    });

    await db.recordKBIMetric(userId, 'goal_adherence', 0.3);
    await db.recordKBIMetric(userId, 'engagement_score', 1);
    await db.recordKBIMetric(userId, 'mood_trend', 2.3);

    const delivery = new CronEventDelivery({
      mode: 'redis',
      redis: db.redis,
      redisListKey: queueKey
    });

    const scheduler = new SchedulerRunner(db, {
      delivery,
      deliverMonitor: true,
      deliverMorning: true
    });

    const monitor = await scheduler.runMonitorCycle({ limitUsers: 1 });
    assert(monitor.outboxQueued >= 1, 'expected monitor outbox queued >=1');
    assert(monitor.outboxDispatched >= 1, 'expected monitor outbox dispatched >=1');

    const morning = await scheduler.runMorningCycle({ limitUsers: 1 });
    assert(morning.outboxQueued >= 1, 'expected morning outbox queued >=1');
    assert(morning.outboxDispatched >= 1, 'expected morning outbox dispatched >=1');

    const dispatchedMonitor = await db.listOutboundEvents({
      status: 'dispatched',
      eventType: 'scheduled_intervention.monitor',
      limit: 50
    });

    const dispatchedMorning = await db.listOutboundEvents({
      status: 'dispatched',
      eventType: 'scheduled_intervention.morning',
      limit: 50
    });

    const monitorRow = dispatchedMonitor.find((r) => r.user_id === userId);
    const morningRow = dispatchedMorning.find((r) => r.user_id === userId);

    assert(!!monitorRow, 'expected dispatched monitor outbox row for user');
    assert(!!morningRow, 'expected dispatched morning outbox row for user');

    assert(monitorRow.payload?.kind === 'systemEvent', 'monitor outbox payload should be systemEvent');
    assert(morningRow.payload?.kind === 'systemEvent', 'morning outbox payload should be systemEvent');

    const queueDepth = await db.redis.llen(queueKey);
    assert(queueDepth >= 2, `expected queue depth >=2, got ${queueDepth}`);

    console.log('✅ outbox flow test passed');
  } finally {
    await db.redis.del(queueKey).catch(() => {});
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ outbox flow test failed:', err.message);
  process.exit(1);
});
