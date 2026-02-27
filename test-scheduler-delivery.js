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
  const rawDb = new DatabaseStorageManager();
  const userId = uuidv4();
  const queueKey = `lifecoach:test:scheduler-delivery:${Date.now()}:${process.pid}`;

  try {
    await rawDb.createUserProfile(userId, {
      name: 'scheduler-delivery-test',
      created_at: new Date().toISOString()
    });

    await rawDb.recordKBIMetric(userId, 'goal_adherence', 0.3);
    await rawDb.recordKBIMetric(userId, 'engagement_score', 1);
    await rawDb.recordKBIMetric(userId, 'mood_trend', 2.2);

    const db = {
      redis: rawDb.redis,
      listUserIds: async () => [userId],
      getLatestKbiSnapshot: (...args) => rawDb.getLatestKbiSnapshot(...args),
      getUserProfile: (...args) => rawDb.getUserProfile(...args),
      logAgentAction: (...args) => rawDb.logAgentAction(...args)
    };

    const delivery = new CronEventDelivery({
      mode: 'redis',
      redis: rawDb.redis,
      redisListKey: queueKey
    });

    const scheduler = new SchedulerRunner(db, {
      delivery,
      deliverMonitor: true,
      deliverMorning: true
    });

    const monitor = await scheduler.runMonitorCycle({ limitUsers: 1 });
    assert(monitor.deliveredEvents >= 1, 'expected monitor cycle to deliver at least one event');

    const morning = await scheduler.runMorningCycle({ limitUsers: 1 });
    assert(morning.deliveredEvents >= 1, 'expected morning cycle to deliver at least one event');

    const queueLen = await rawDb.redis.llen(queueKey);
    assert(queueLen >= 2, `expected >=2 queued events, got ${queueLen}`);

    const events = await rawDb.redis.lrange(queueKey, 0, -1);
    const parsed = events.map((x) => JSON.parse(x));
    const hasMonitor = parsed.some((e) => e.cycle === 'monitor');
    const hasMorning = parsed.some((e) => e.cycle === 'morning');

    assert(hasMonitor, 'missing monitor event in queue');
    assert(hasMorning, 'missing morning event in queue');

    console.log('✅ scheduler delivery integration test passed');
  } finally {
    await rawDb.redis.del(queueKey).catch(() => {});
    await rawDb.close();
  }
}

run().catch((err) => {
  console.error('❌ scheduler delivery integration test failed:', err.message);
  process.exit(1);
});
