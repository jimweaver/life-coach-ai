#!/usr/bin/env node

/**
 * Test consolidated metrics dashboard endpoint
 */

require('dotenv').config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchDashboard() {
  const res = await fetch(`${API_BASE}/metrics/dashboard`);
  return res.json();
}

async function run() {
  console.log('Testing consolidated metrics dashboard...\n');

  try {
    // Test 1: Basic endpoint access
    console.log('Test 1: Basic endpoint access...');
    const data = await fetchDashboard();
    assert(data.ok === true, 'should return ok: true');
    assert(data.summary !== undefined, 'should have summary');
    assert(data.services !== undefined, 'should have services');
    console.log('✅ Basic endpoint access works');

    // Test 2: Summary fields
    console.log('\nTest 2: Summary fields...');
    assert(typeof data.summary.api_requests === 'number', 'should have api_requests');
    assert(typeof data.summary.orchestrator_requests === 'number', 'should have orchestrator_requests');
    assert(typeof data.summary.db_queries === 'number', 'should have db_queries');
    assert(typeof data.summary.db_pool_utilization === 'string', 'should have db_pool_utilization');
    assert(typeof data.summary.overall_health === 'boolean', 'should have overall_health');
    console.log('✅ Summary fields present');

    // Test 3: Services
    console.log('\nTest 3: Services...');
    assert(data.services.orchestrator !== undefined, 'should have orchestrator service');
    assert(data.services.pools !== undefined, 'should have pools service');
    assert(data.services.queries !== undefined, 'should have queries service');
    assert(data.services.latency !== undefined, 'should have latency service');
    console.log('✅ Services present');

    // Test 4: Orchestrator service
    console.log('\nTest 4: Orchestrator service...');
    assert(data.services.orchestrator.requests !== undefined, 'orchestrator should have requests');
    assert(data.services.orchestrator.latency !== undefined, 'orchestrator should have latency');
    assert(data.services.orchestrator.errors !== undefined, 'orchestrator should have errors');
    console.log('✅ Orchestrator service valid');

    // Test 5: Pools service
    console.log('\nTest 5: Pools service...');
    assert(data.services.pools.postgres !== undefined, 'pools should have postgres');
    assert(data.services.pools.redis !== undefined, 'pools should have redis');
    assert(data.services.pools.healthy !== undefined, 'pools should have healthy');
    console.log('✅ Pools service valid');

    // Test 6: Queries service
    console.log('\nTest 6: Queries service...');
    assert(typeof data.services.queries.total_queries === 'number', 'queries should have total_queries');
    assert(Array.isArray(data.services.queries.query_types), 'queries should have query_types');
    console.log('✅ Queries service valid');

    // Test 7: Latency service
    console.log('\nTest 7: Latency service...');
    assert(data.services.latency.histogram !== undefined, 'latency should have histogram');
    assert(typeof data.services.latency.total_requests === 'number', 'latency should have total_requests');
    console.log('✅ Latency service valid');

    // Test 8: Timestamp
    console.log('\nTest 8: Timestamp...');
    assert(typeof data.generated_at === 'string', 'should have generated_at');
    console.log('✅ Timestamp present');

    console.log('\n✅ All dashboard tests passed');
    console.log('\nSummary:');
    console.log(JSON.stringify(data.summary, null, 2));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
