#!/usr/bin/env node

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const DeployEventSink = require('./scripts/deploy-event-sink');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const runId = uuidv4();
  const tableName = `deploy_run_events_test`;

  const sink = new DeployEventSink({
    runId,
    mode: 'postgres',
    tableName,
    source: 'deploy-wrapper-test'
  });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://tj@localhost:5432/life_coach'
  });

  try {
    const status = sink.status();
    assert(status.enabled === true, 'event sink should be enabled');
    assert(status.mode === 'postgres', 'event sink mode should be postgres');

    const w1 = await sink.write({ level: 'info', event: 'test.start', ts: new Date().toISOString(), hello: 'world' });
    const w2 = await sink.write({ level: 'error', event: 'test.fail', ts: new Date().toISOString(), reason: 'simulated' });

    assert(w1.stored === true, 'expected first event stored');
    assert(w2.stored === true, 'expected second event stored');

    const rows = await pool.query(
      `SELECT level, event, payload
       FROM ${tableName}
       WHERE run_id = $1
       ORDER BY id ASC`,
      [runId]
    );

    assert(rows.rows.length >= 2, `expected >=2 rows for run_id, got ${rows.rows.length}`);
    assert(rows.rows[0].event === 'test.start', `expected first event test.start, got ${rows.rows[0].event}`);

    const hasError = rows.rows.some((r) => r.level === 'error' && r.event === 'test.fail');
    assert(hasError, 'expected stored error event test.fail');

    console.log('✅ deploy event sink test passed');
  } finally {
    try {
      await pool.query(`DELETE FROM ${tableName} WHERE run_id = $1`, [runId]);
    } catch (_e) {
      // ignore cleanup errors
    }

    await sink.close().catch(() => {});
    await pool.end().catch(() => {});
  }
}

run().catch((err) => {
  console.error('❌ deploy event sink test failed:', err.message);
  process.exit(1);
});
