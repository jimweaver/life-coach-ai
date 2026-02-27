#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const createServer = require('./core/api-server');
const DatabaseStorageManager = require('./core/storage/database-storage');
const { appendHistory } = require('./scripts/canary-check');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  // isolate from unrelated middleware constraints
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lifecoach-canary-suppress-'));
  const historyFile = path.join(tmpDir, 'history.jsonl');
  const queueKey = `lifecoach:test:canary-suppression:${Date.now()}:${process.pid}`;
  const stateKey = `lifecoach:test:canary-suppression:state:${Date.now()}:${process.pid}`;

  try {
    // Stable baseline
    for (let i = 0; i < 8; i += 1) {
      await appendHistory(historyFile, {
        ok: true,
        rollback_recommended: false,
        request_count: 3,
        metrics: {
          error_rate: i % 4 === 0 ? 0.05 : 0,
          p95_ms: 1000 + i * 40,
          avg_ms: 700 + i * 30
        },
        thresholds: {
          max_error_rate: 0.2,
          max_p95_ms: 3500,
          max_avg_ms: 2200
        }
      });
    }

    process.env.CANARY_HISTORY_FILE = historyFile;

    // Deliberately drifted active thresholds
    process.env.CANARY_MAX_ERROR_RATE = '0.6';
    process.env.CANARY_P95_MAX_MS = '9000';
    process.env.CANARY_AVG_MAX_MS = '8000';

    process.env.CANARY_PROFILE_MIN_SAMPLES = '5';
    process.env.CANARY_DRIFT_WARN_RATIO = '0.2';
    process.env.CANARY_DRIFT_CRITICAL_RATIO = '0.4';

    // Route + delivery enabled so first route can persist suppression state
    process.env.CANARY_DRIFT_ROUTE_ENABLED = 'true';
    process.env.CANARY_DRIFT_ROUTE_MIN_LEVEL = 'warn';

    process.env.ALERT_ROUTING_ENABLED = 'true';
    process.env.ALERT_ROUTING_MIN_LEVEL = 'warn';
    process.env.CRON_DELIVERY_MODE = 'redis';
    process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;

    // Suppression policy under test
    process.env.CANARY_DRIFT_SUPPRESSION_ENABLED = 'true';
    process.env.CANARY_DRIFT_COOLDOWN_MINUTES = '120';
    process.env.CANARY_DRIFT_DUPLICATE_WINDOW_MINUTES = '240';
    process.env.CANARY_DRIFT_STATE_KEY = stateKey;
    process.env.CANARY_DRIFT_STATE_TTL_SEC = '3600';

    const { shutdown } = await createServer();

    try {
      const base = 'http://localhost:8787';

      const first = await fetch(`${base}/jobs/canary/drift?route=true&emitAudit=true&suppress=true&minSamples=5`);
      assert(first.status === 200, `first call expected 200, got ${first.status}`);
      const firstBody = await first.json();

      assert(firstBody.ok === true, 'first payload ok should be true');
      assert(firstBody.drift?.drift_detected === true, 'first call should detect drift');
      assert(firstBody.route?.candidate === true, 'first call should be route candidate');
      assert(firstBody.route?.attempted === true, 'first call should attempt route');
      assert(firstBody.route?.suppression?.suppressed === false, 'first call should not be suppressed');
      assert(firstBody.routed?.routed === true, 'first call should be routed');

      const second = await fetch(`${base}/jobs/canary/drift?route=true&emitAudit=true&suppress=true&minSamples=5`);
      assert(second.status === 200, `second call expected 200, got ${second.status}`);
      const secondBody = await second.json();

      assert(secondBody.ok === true, 'second payload ok should be true');
      assert(secondBody.route?.candidate === true, 'second call should still be route candidate');
      assert(secondBody.route?.attempted === false, 'second call should not attempt route due to suppression');
      assert(secondBody.route?.suppression?.suppressed === true, 'second call should be suppressed');
      assert(
        ['duplicate_within_window', 'cooldown_active'].includes(secondBody.route?.suppression?.reason),
        `unexpected suppression reason: ${secondBody.route?.suppression?.reason}`
      );

      const db = new DatabaseStorageManager();
      try {
        const logs = await db.getAgentLogs('canary-monitor', 50);
        const suppressedLog = logs.find((x) => x.action === 'canary_profile_drift_route_suppressed');
        assert(!!suppressedLog, 'expected canary_profile_drift_route_suppressed audit log');
      } finally {
        await db.close();
      }

      console.log('✅ canary drift suppression test passed');
    } finally {
      await shutdown();
    }

    const cleanupDb = new DatabaseStorageManager();
    try {
      await cleanupDb.redis.del(queueKey).catch(() => {});
      await cleanupDb.redis.del(stateKey).catch(() => {});
    } finally {
      await cleanupDb.close();
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((err) => {
  console.error('❌ canary drift suppression test failed:', err.message);
  process.exit(1);
});
