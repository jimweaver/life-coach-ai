#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const createServer = require('./core/api-server');
const DatabaseStorageManager = require('./core/storage/database-storage');
const { appendHistory } = require('./scripts/canary-check');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lifecoach-canary-suppress-observe-'));
  const historyFile = path.join(tmpDir, 'history.jsonl');
  const queueKey = `lifecoach:test:canary-suppression-observe:${Date.now()}:${process.pid}`;
  const stateKey = `lifecoach:test:canary-suppression-observe:state:${Date.now()}:${process.pid}`;

  try {
    // Build stable baseline
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

    process.env.CANARY_DRIFT_ROUTE_ENABLED = 'true';
    process.env.CANARY_DRIFT_ROUTE_MIN_LEVEL = 'warn';

    process.env.ALERT_ROUTING_ENABLED = 'true';
    process.env.ALERT_ROUTING_MIN_LEVEL = 'warn';
    process.env.ALERT_ROUTING_USER_ID = uuidv4();

    process.env.CRON_DELIVERY_MODE = 'redis';
    process.env.CRON_EVENT_REDIS_LIST_KEY = queueKey;

    process.env.CANARY_DRIFT_SUPPRESSION_ENABLED = 'true';
    process.env.CANARY_DRIFT_COOLDOWN_MINUTES = '120';
    process.env.CANARY_DRIFT_DUPLICATE_WINDOW_MINUTES = '240';
    process.env.CANARY_DRIFT_STATE_KEY = stateKey;
    process.env.CANARY_DRIFT_STATE_TTL_SEC = '3600';

    const { shutdown } = await createServer();

    try {
      const base = 'http://localhost:8787';

      const prime = await fetch(`${base}/jobs/canary/drift?route=true&emitAudit=true&suppress=true&minSamples=5`);
      assert(prime.status === 200, `prime call expected 200, got ${prime.status}`);
      const primeBody = await prime.json();

      assert(primeBody.ok === true, 'prime payload ok should be true');
      assert(primeBody.drift?.drift_detected === true, 'prime call should detect drift');
      assert(primeBody.route?.candidate === true, 'prime call should be route candidate');
      assert(primeBody.route?.attempted === true, 'prime call should attempt route');
      assert(primeBody.route?.suppression?.suppressed === false, 'prime call should not be suppressed');
      assert(primeBody.routed?.routed === true, 'prime call should route and seed suppression state');

      const obs = await fetch(`${base}/jobs/delivery/canary-drift/suppression?minSamples=5`);
      assert(obs.status === 200, `observability endpoint expected 200, got ${obs.status}`);
      const body = await obs.json();

      assert(body.ok === true, 'observability payload ok should be true');
      assert(body.drift?.drift_detected === true, 'observability payload should include drift detection');
      assert(body.route?.candidate === true, 'observability route candidate should be true');
      assert(body.suppression?.enabled === true, 'suppression must be enabled');
      assert(body.suppression?.suppressed === true, 'suppression should be active after prime route');
      assert(
        ['duplicate_within_window', 'cooldown_active'].includes(body.suppression?.reason),
        `unexpected suppression reason: ${body.suppression?.reason}`
      );
      assert(typeof body.history_file === 'string' && body.history_file.length > 0, 'history_file should be present');
      assert(body.profile?.ready === true, 'profile should be ready');

      const bad = await fetch(`${base}/jobs/delivery/canary-drift/suppression?minSamples=0`);
      assert(bad.status === 400, `invalid minSamples expected 400, got ${bad.status}`);

      console.log('✅ canary drift suppression observability test passed');
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
  console.error('❌ canary drift suppression observability test failed:', err.message);
  process.exit(1);
});
