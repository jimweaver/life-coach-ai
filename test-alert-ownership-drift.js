#!/usr/bin/env node

require('dotenv').config();
const DatabaseStorageManager = require('./core/storage/database-storage');
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  // keep test deterministic and isolated
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';

  process.env.DELIVERY_ALERT_ONCALL_SYNC_ENABLED = 'true';
  process.env.DELIVERY_ALERT_ONCALL_FILE = '/tmp/lifecoach-nonexistent-oncall-roster.json';
  process.env.DELIVERY_ALERT_ONCALL_REFRESH_MS = '1000';

  process.env.ALERT_OWNER_DRIFT_WARN_STALE_MINUTES = '1';
  process.env.ALERT_OWNER_DRIFT_CRITICAL_STALE_MINUTES = '2';
  process.env.ALERT_OWNER_DRIFT_STRICT = 'false';

  process.env.DELIVERY_ALERT_ESCALATION_ENABLED = 'false';

  const { shutdown } = await createServer();

  try {
    const base = 'http://localhost:8787';

    const res = await fetch(`${base}/jobs/delivery/ownership-drift?sync=true&emitAudit=true`);
    assert(res.status === 200, `ownership drift endpoint expected 200, got ${res.status}`);

    const payload = await res.json();
    assert(payload.ok === true, 'payload.ok should be true');
    assert(payload.drift?.drift_detected === true, 'expected drift_detected=true');
    assert(['warn', 'critical'].includes(payload.drift?.level), `unexpected drift level: ${payload.drift?.level}`);

    const reasons = payload.drift?.reasons || [];
    assert(reasons.includes('oncall_sync_error'), 'expected oncall_sync_error reason');
    assert(reasons.includes('missing_warn_owner'), 'expected missing_warn_owner reason');
    assert(reasons.includes('missing_critical_owner'), 'expected missing_critical_owner reason');

    const db = new DatabaseStorageManager();
    try {
      const logs = await db.getAgentLogs('delivery-alert', 30);
      const driftLog = logs.find((x) => x.action === 'ownership_drift_detected');
      assert(!!driftLog, 'expected ownership_drift_detected audit log');
      assert(Array.isArray(driftLog.metadata?.reasons), 'drift audit metadata should include reasons array');
    } finally {
      await db.close();
    }

    console.log('✅ alert ownership drift test passed');
  } finally {
    await shutdown();
  }
}

run().catch((err) => {
  console.error('❌ alert ownership drift test failed:', err.message);
  process.exit(1);
});
