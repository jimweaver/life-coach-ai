#!/usr/bin/env node

/**
 * Test webhook delivery success rate metrics
 */

require('dotenv').config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchDeliveryMetrics() {
  const res = await fetch(`${API_BASE}/metrics/delivery`);
  return res.json();
}

async function run() {
  console.log('Testing webhook delivery success rate metrics...\n');

  try {
    // Test 1: Basic endpoint access
    console.log('Test 1: Basic endpoint access...');
    const data = await fetchDeliveryMetrics();
    assert(data.ok === true, 'should return ok: true');
    assert(typeof data.total_deliveries === 'number', 'should have total_deliveries');
    assert(typeof data.successful === 'number', 'should have successful');
    assert(typeof data.failed === 'number', 'should have failed');
    assert(typeof data.success_rate === 'string', 'should have success_rate');
    console.log('✅ Basic endpoint access works');

    // Test 2: By mode breakdown
    console.log('\nTest 2: By mode breakdown...');
    assert(Array.isArray(data.by_mode), 'should have by_mode array');
    console.log('✅ By mode breakdown present');

    // Test 3: Error reasons
    console.log('\nTest 3: Error reasons...');
    assert(Array.isArray(data.error_reasons), 'should have error_reasons array');
    console.log('✅ Error reasons present');

    // Test 4: Response time stats
    console.log('\nTest 4: Response time stats...');
    assert(data.response_time_ms !== undefined, 'should have response_time_ms');
    assert(typeof data.response_time_ms.avg === 'number', 'should have avg response time');
    assert(typeof data.response_time_ms.min === 'number', 'should have min response time');
    assert(typeof data.response_time_ms.max === 'number', 'should have max response time');
    console.log('✅ Response time stats present');

    // Test 5: Recent errors
    console.log('\nTest 5: Recent errors...');
    assert(Array.isArray(data.recent_errors), 'should have recent_errors array');
    console.log('✅ Recent errors present');

    // Test 6: Timestamp
    console.log('\nTest 6: Timestamp...');
    assert(typeof data.generated_at === 'string', 'should have generated_at');
    console.log('✅ Timestamp present');

    console.log('\n✅ All delivery metrics tests passed');
    console.log('\nDelivery stats:');
    console.log(JSON.stringify({
      total_deliveries: data.total_deliveries,
      success_rate: data.success_rate,
      by_mode: data.by_mode,
      response_time_ms: data.response_time_ms
    }, null, 2));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
