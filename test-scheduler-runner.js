#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DatabaseStorageManager = require('./core/storage/database-storage');
const SchedulerRunner = require('./core/scheduler-runner');

async function run() {
  const db = new DatabaseStorageManager();
  const scheduler = new SchedulerRunner(db);

  const userId = uuidv4();

  try {
    await db.createUserProfile(userId, {
      name: 'scheduler-test-user',
      created_at: new Date().toISOString()
    });

    await db.recordKBIMetric(userId, 'goal_adherence', 0.35);
    await db.recordKBIMetric(userId, 'engagement_score', 1);
    await db.recordKBIMetric(userId, 'mood_trend', 2.4);

    const monitor = await scheduler.runMonitorCycle({ limitUsers: 50 });
    if (monitor.scannedUsers < 1) throw new Error('monitor scannedUsers invalid');
    if (monitor.interventions < 1) throw new Error('expected at least one intervention');

    const morning = await scheduler.runMorningCycle({ limitUsers: 10 });
    if (morning.targetedUsers < 1) throw new Error('morning cycle targetedUsers invalid');

    console.log('✅ scheduler runner test passed');
  } finally {
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ scheduler runner test failed:', err.message);
  process.exit(1);
});
