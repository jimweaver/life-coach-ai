#!/usr/bin/env node

require('dotenv').config();
const createServer = require('./core/api-server');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  process.env.RATE_LIMIT_BACKEND = 'memory';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX_JOBS = '1000';
  process.env.DELIVERY_ALERT_ONCALL_SYNC_ENABLED = 'true';
  process.env.DELIVERY_ALERT_ONCALL_FILE = '/tmp/nonexistent.json';
  process.env.ALERT_OWNER_DRIFT_SUPPRESSION_ENABLED = 'true';
  process.env.ALERT_OWNER_DRIFT_COOLDOWN_MINUTES = '1';
  process.env.ALERT_OWNER_DRIFT_DUPLICATE_WINDOW_MINUTES = '1';
  process.env.ALERT_OWNER_DRIFT_STRICT = 'false';

  const { shutdown } = await createServer();
  const base = 'http://localhost:8787';

  try {
    const res = await fetch(`${base}/jobs/delivery/ownership-drift/suppression?sync=true`);
    assert(res.status === 200, `suppression endpoint expected 200, got ${res.status}`);

    const body = await res.json();
    assert(body.ok === true, 'response ok should be true');
    assert(typeof body.suppression === 'object', 'suppression object missing');
    assert('remaining_ms' in body.suppression, 'remaining_ms missing');

    console.log('✅ ownership suppression test passed');
  } finally {
    await shutdown();
  }
}

run().catch((err) => {
  console.error('❌ ownership suppression test failed:', err.message);
  process.exit(1);
});
