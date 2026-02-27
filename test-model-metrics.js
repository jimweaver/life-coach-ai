#!/usr/bin/env node

/**
 * Test model call latency metrics
 */

require('dotenv').config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchModelMetrics() {
  const res = await fetch(`${API_BASE}/metrics/model`);
  return res.json();
}

async function run() {
  console.log('Testing model call latency metrics...\n');

  try {
    // Test 1: Basic endpoint access
    console.log('Test 1: Basic endpoint access...');
    const data = await fetchModelMetrics();
    assert(data.ok === true, 'should return ok: true');
    assert(typeof data.total_calls === 'number', 'should have total_calls');
    assert(typeof data.successful === 'number', 'should have successful');
    assert(typeof data.failed === 'number', 'should have failed');
    assert(typeof data.success_rate === 'string', 'should have success_rate');
    assert(typeof data.avg_duration_ms === 'number', 'should have avg_duration_ms');
    console.log('✅ Basic endpoint access works');

    // Test 2: By model breakdown
    console.log('\nTest 2: By model breakdown...');
    assert(Array.isArray(data.by_model), 'should have by_model array');
    console.log('✅ By model breakdown present');

    // Test 3: By domain breakdown
    console.log('\nTest 3: By domain breakdown...');
    assert(Array.isArray(data.by_domain), 'should have by_domain array');
    console.log('✅ By domain breakdown present');

    // Test 4: Retry distribution
    console.log('\nTest 4: Retry distribution...');
    assert(data.retry_distribution !== undefined, 'should have retry_distribution');
    console.log('✅ Retry distribution present');

    // Test 5: Error reasons
    console.log('\nTest 5: Error reasons...');
    assert(Array.isArray(data.error_reasons), 'should have error_reasons array');
    console.log('✅ Error reasons present');

    // Test 6: Slow calls
    console.log('\nTest 6: Slow calls...');
    assert(data.slow_calls !== undefined, 'should have slow_calls');
    assert(typeof data.slow_calls.count === 'number', 'should have slow_calls.count');
    console.log('✅ Slow calls present');

    // Test 7: Timestamp
    console.log('\nTest 7: Timestamp...');
    assert(typeof data.generated_at === 'string', 'should have generated_at');
    console.log('✅ Timestamp present');

    console.log('\n✅ All model metrics tests passed');
    console.log('\nModel stats:');
    console.log(JSON.stringify({
      total_calls: data.total_calls,
      success_rate: data.success_rate,
      avg_duration_ms: data.avg_duration_ms,
      retry_distribution: data.retry_distribution,
      slow_calls: data.slow_calls.count
    }, null, 2));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
