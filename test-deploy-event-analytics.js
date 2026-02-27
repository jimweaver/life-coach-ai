#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const DeployEventSink = require('./scripts/deploy-event-sink');
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const runA = uuidv4();
  const runB = uuidv4();

  // prevent side effects from policy/rate limit in this test
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  const sinkA = new DeployEventSink({ runId: runA, source: 'test-deploy-analytics-a' });
  const sinkB = new DeployEventSink({ runId: runB, source: 'test-deploy-analytics-b' });

  const db = new DatabaseStorageManager();

  try {
    const marker = { test_suite: 'deploy_event_analytics' };

    await sinkA.write({ event: 'preflight.start', level: 'info', ts: new Date().toISOString(), ...marker, run_label: 'A' });
    await sinkA.write({ event: 'preflight.end', level: 'info', ts: new Date().toISOString(), ...marker, run_label: 'A' });
    await sinkA.write({ event: 'smoke.quick.end', level: 'warn', ts: new Date().toISOString(), ...marker, run_label: 'A' });

    await sinkB.write({ event: 'preflight.start', level: 'info', ts: new Date().toISOString(), ...marker, run_label: 'B' });
    await sinkB.write({
      event: 'legacy.event',
      level: 'debug',
      ts: new Date(Date.now() - (180 * 60 * 1000)).toISOString(), // 3h old
      ...marker,
      run_label: 'B-old'
    });

    const { shutdown } = await createServer();
    const base = 'http://localhost:8787';

    try {
      const eventsRunA = await fetch(`${base}/jobs/deploy-events?runId=${runA}&limit=20`);
      assert(eventsRunA.status === 200, `deploy-events runA expected 200, got ${eventsRunA.status}`);
      const bodyA = await eventsRunA.json();
      assert(bodyA.ok === true, 'deploy-events runA payload ok should be true');
      assert(bodyA.count >= 3, `expected at least 3 events for runA, got ${bodyA.count}`);
      assert(bodyA.events.every((e) => e.run_id === runA), 'runA filter should only return runA records');

      const filtered = await fetch(`${base}/jobs/deploy-events?runId=${runA}&event=smoke.quick.end&level=warn&limit=20`);
      assert(filtered.status === 200, `deploy-events filtered expected 200, got ${filtered.status}`);
      const filteredBody = await filtered.json();
      assert(filteredBody.count >= 1, 'expected at least one filtered event');
      assert(filteredBody.events.every((e) => e.event === 'smoke.quick.end' && e.level === 'warn'), 'event/level filters not applied');

      const recent = await fetch(`${base}/jobs/deploy-events?runId=${runB}&sinceMinutes=60&limit=20`);
      assert(recent.status === 200, `deploy-events recent expected 200, got ${recent.status}`);
      const recentBody = await recent.json();
      assert(recentBody.events.every((e) => e.event !== 'legacy.event'), 'sinceMinutes should exclude old legacy event');

      const summary = await fetch(`${base}/jobs/deploy-events/summary?runId=${runA}&sinceMinutes=240`);
      assert(summary.status === 200, `deploy-events summary expected 200, got ${summary.status}`);
      const summaryBody = await summary.json();
      assert(summaryBody.ok === true, 'summary payload ok should be true');
      assert(Array.isArray(summaryBody.summary), 'summary should be an array');
      assert(summaryBody.summary.some((x) => x.event === 'preflight.start'), 'summary missing preflight.start');

      const invalid = await fetch(`${base}/jobs/deploy-events?runId=bad-id`);
      assert(invalid.status === 400, `invalid runId should return 400, got ${invalid.status}`);

      console.log('✅ deploy event analytics test passed');
    } finally {
      await shutdown();
    }

    await db.ensureDeployRunEventsTable();
    await db.postgres.query(
      `DELETE FROM deploy_run_events WHERE payload->>'test_suite' = 'deploy_event_analytics'`
    );
  } finally {
    await Promise.allSettled([sinkA.close(), sinkB.close()]);
    await db.close();
  }
}

run().catch((err) => {
  console.error('❌ deploy event analytics test failed:', err.message);
  process.exit(1);
});
