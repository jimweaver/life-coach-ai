#!/usr/bin/env node

/**
 * Test deep health check endpoint
 */

require('dotenv').config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchDeepHealth() {
  const res = await fetch(`${API_BASE}/health/deep`);
  const data = await res.json();
  return { status: res.status, data };
}

async function run() {
  console.log('Testing deep health check endpoint...\n');

  try {
    // Test 1: Basic endpoint access
    console.log('Test 1: Basic endpoint access...');
    const { status, data } = await fetchDeepHealth();
    assert(data.ok !== undefined, 'should have ok field');
    assert(data.checks !== undefined, 'should have checks object');
    assert(typeof data.latency_ms === 'number', 'should have latency_ms');
    assert(typeof data.timestamp === 'string', 'should have timestamp');
    console.log(`✅ Basic endpoint access works (HTTP ${status})`);

    // Test 2: Connectivity check
    console.log('\nTest 2: Connectivity check...');
    assert(data.checks.connectivity !== undefined, 'should have connectivity check');
    assert(typeof data.checks.connectivity.ok === 'boolean', 'connectivity should have ok');
    assert(typeof data.checks.connectivity.redis === 'boolean', 'should have redis status');
    assert(typeof data.checks.connectivity.postgres === 'boolean', 'should have postgres status');
    console.log('✅ Connectivity check present');

    // Test 3: Pool health check
    console.log('\nTest 3: Pool health check...');
    assert(data.checks.pool_health !== undefined, 'should have pool_health check');
    assert(typeof data.checks.pool_health.ok === 'boolean', 'pool_health should have ok');
    assert(data.checks.pool_health.postgres !== undefined, 'should have postgres pool info');
    assert(data.checks.pool_health.redis !== undefined, 'should have redis pool info');
    console.log('✅ Pool health check present');

    // Test 4: Query performance check
    console.log('\nTest 4: Query performance check...');
    assert(data.checks.query_performance !== undefined, 'should have query_performance check');
    assert(typeof data.checks.query_performance.ok === 'boolean', 'query_performance should have ok');
    assert(typeof data.checks.query_performance.latency_ms === 'number', 'should have latency_ms');
    console.log(`   Query latency: ${data.checks.query_performance.latency_ms}ms`);
    console.log('✅ Query performance check present');

    // Test 5: Memory check
    console.log('\nTest 5: Memory check...');
    assert(data.checks.memory !== undefined, 'should have memory check');
    assert(typeof data.checks.memory.ok === 'boolean', 'memory should have ok');
    assert(typeof data.checks.memory.heap_used_mb === 'number', 'should have heap_used_mb');
    assert(typeof data.checks.memory.heap_total_mb === 'number', 'should have heap_total_mb');
    assert(typeof data.checks.memory.rss_mb === 'number', 'should have rss_mb');
    console.log(`   Heap used: ${data.checks.memory.heap_used_mb}MB`);
    console.log('✅ Memory check present');

    // Test 6: Connections check
    console.log('\nTest 6: Connections check...');
    assert(data.checks.connections !== undefined, 'should have connections check');
    assert(typeof data.checks.connections.ok === 'boolean', 'connections should have ok');
    assert(typeof data.checks.connections.active_sockets === 'number', 'should have active_sockets');
    assert(typeof data.checks.connections.total_tracked === 'number', 'should have total_tracked');
    console.log(`   Active sockets: ${data.checks.connections.active_sockets}`);
    console.log('✅ Connections check present');

    // Test 7: Shutdown status check
    console.log('\nTest 7: Shutdown status check...');
    assert(data.checks.shutdown_status !== undefined, 'should have shutdown_status check');
    assert(typeof data.checks.shutdown_status.ok === 'boolean', 'shutdown_status should have ok');
    assert(typeof data.checks.shutdown_status.shutting_down === 'boolean', 'should have shutting_down');
    assert(typeof data.checks.shutdown_status.graceful_shutdown_ms === 'number', 'should have graceful_shutdown_ms');
    console.log('✅ Shutdown status check present');

    // Test 8: Overall health consistency
    console.log('\nTest 8: Overall health consistency...');
    const checksOk = Object.values(data.checks).every(c => c.ok);
    assert(data.ok === checksOk, 'overall ok should match all checks');
    console.log(`   Overall health: ${data.ok ? 'HEALTHY' : 'UNHEALTHY'}`);
    console.log('✅ Overall health consistent');

    console.log('\n✅ All deep health check tests passed');
    console.log('\nSample response:');
    console.log(JSON.stringify(data.checks, null, 2));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
