#!/usr/bin/env node

/**
 * Test connection pool monitoring
 */

require('dotenv').config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchPoolMetrics() {
  const res = await fetch(`${API_BASE}/health/pools`);
  return res.json();
}

async function run() {
  console.log('Testing connection pool monitoring...\n');

  try {
    // Test 1: Basic endpoint access
    console.log('Test 1: Basic endpoint access...');
    const data = await fetchPoolMetrics();
    assert(data.ok === true, 'should return ok: true');
    assert(data.pools !== undefined, 'should have pools object');
    console.log('✅ Basic endpoint access works');

    // Test 2: PostgreSQL pool metrics
    console.log('\nTest 2: PostgreSQL pool metrics...');
    assert(data.pools.postgres !== undefined, 'should have postgres metrics');
    assert(typeof data.pools.postgres.total === 'number', 'should have total count');
    assert(typeof data.pools.postgres.idle === 'number', 'should have idle count');
    assert(typeof data.pools.postgres.waiting === 'number', 'should have waiting count');
    assert(typeof data.pools.postgres.max === 'number', 'should have max connections');
    assert(typeof data.pools.postgres.utilization === 'number', 'should have utilization ratio');
    console.log('✅ PostgreSQL metrics present');

    // Test 3: Redis metrics
    console.log('\nTest 3: Redis metrics...');
    assert(data.pools.redis !== undefined, 'should have redis metrics');
    assert(typeof data.pools.redis.status === 'string', 'should have status string');
    assert(typeof data.pools.redis.reconnectAttempts === 'number', 'should have reconnect attempts');
    console.log('✅ Redis metrics present');

    // Test 4: Health status
    console.log('\nTest 4: Health status...');
    assert(data.pools.healthy !== undefined, 'should have healthy object');
    assert(typeof data.pools.healthy.postgres === 'boolean', 'should have postgres health');
    assert(typeof data.pools.healthy.redis === 'boolean', 'should have redis health');
    assert(typeof data.pools.healthy.overall === 'boolean', 'should have overall health');
    console.log('✅ Health status present');

    // Test 5: Utilization calculation
    console.log('\nTest 5: Utilization calculation...');
    const pg = data.pools.postgres;
    const expectedUtil = pg.total > 0 ? (pg.total - pg.idle) / pg.total : 0;
    assert(Math.abs(pg.utilization - expectedUtil) < 0.001, 'utilization should be calculated correctly');
    console.log(`   Utilization: ${(pg.utilization * 100).toFixed(1)}%`);
    console.log('✅ Utilization calculation correct');

    console.log('\n✅ All connection pool monitoring tests passed');
    console.log('\nSample response:');
    console.log(JSON.stringify(data.pools, null, 2));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
