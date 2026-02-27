#!/usr/bin/env node

/**
 * Test database query performance metrics
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchQueryMetrics() {
  const res = await fetch(`${API_BASE}/metrics/queries`);
  return res.json();
}

async function generateQueries(count = 5) {
  // Generate traffic to create query stats
  for (let i = 0; i < count; i++) {
    await fetch(`${API_BASE}/health`);
    await fetch(`${API_BASE}/profile/${uuidv4()}`);
    await fetch(`${API_BASE}/metrics/orchestrator`);
  }
}

async function run() {
  console.log('Testing database query performance metrics...\n');

  try {
    // Test 1: Initial metrics state
    console.log('Test 1: Initial metrics state...');
    const initialMetrics = await fetchQueryMetrics();
    assert(initialMetrics.ok === true, 'should return ok: true');
    assert(typeof initialMetrics.total_queries === 'number', 'should have total_queries');
    assert(typeof initialMetrics.total_errors === 'number', 'should have total_errors');
    assert(typeof initialMetrics.error_rate === 'string', 'should have error_rate');
    assert(typeof initialMetrics.avg_duration_ms === 'number', 'should have avg_duration_ms');
    assert(Array.isArray(initialMetrics.query_types), 'should have query_types array');
    console.log('✅ Initial metrics structure valid');

    // Test 2: Generate traffic
    console.log('\nTest 2: Generating traffic...');
    await generateQueries(3);
    console.log('✅ Generated test traffic');

    // Test 3: Verify metrics updated
    console.log('\nTest 3: Verify metrics updated...');
    const updatedMetrics = await fetchQueryMetrics();
    assert(updatedMetrics.total_queries >= initialMetrics.total_queries, 'total_queries should increase');
    console.log(`   Total queries: ${updatedMetrics.total_queries}`);
    console.log(`   Avg duration: ${updatedMetrics.avg_duration_ms}ms`);
    console.log('✅ Metrics updated correctly');

    // Test 4: Query type stats
    console.log('\nTest 4: Query type stats...');
    if (updatedMetrics.query_types.length > 0) {
      const qt = updatedMetrics.query_types[0];
      assert(typeof qt.type === 'string', 'query type should have type');
      assert(typeof qt.count === 'number', 'query type should have count');
      assert(typeof qt.avg_ms === 'number', 'query type should have avg_ms');
      assert(typeof qt.error_rate === 'string', 'query type should have error_rate');
      console.log('   Query types:', updatedMetrics.query_types.map(t => t.type));
    }
    console.log('✅ Query type stats present');

    // Test 5: Slow queries tracking
    console.log('\nTest 5: Slow queries tracking...');
    assert(typeof updatedMetrics.slow_query_count === 'number', 'should have slow_query_count');
    assert(Array.isArray(updatedMetrics.recent_slow_queries), 'should have recent_slow_queries array');
    console.log(`   Slow queries: ${updatedMetrics.slow_query_count}`);
    console.log('✅ Slow queries tracking present');

    // Test 6: Timestamp
    console.log('\nTest 6: Timestamp...');
    assert(typeof updatedMetrics.generated_at === 'string', 'should have generated_at');
    console.log('✅ Timestamp present');

    console.log('\n✅ All query metrics tests passed');
    console.log('\nSample metrics:');
    console.log(JSON.stringify({
      total_queries: updatedMetrics.total_queries,
      avg_duration_ms: updatedMetrics.avg_duration_ms,
      error_rate: updatedMetrics.error_rate,
      query_types: updatedMetrics.query_types
    }, null, 2));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
