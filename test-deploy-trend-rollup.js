#!/usr/bin/env node

/**
 * Test deploy trend telemetry rollup endpoint
 */

require('dotenv').config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchTrendRollup(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/jobs/deploy-events/trend/rollup?${qs}`);
  return res.json();
}

async function run() {
  console.log('Testing deploy trend telemetry rollup...\n');

  try {
    // Test 1: Basic endpoint access
    console.log('Test 1: Basic endpoint access...');
    const data = await fetchTrendRollup();
    assert(data.ok === true, 'should return ok: true');
    assert(data.filters !== undefined, 'should have filters');
    assert(data.rollup !== undefined, 'should have rollup');
    assert(data.timeline !== undefined, 'should have timeline');
    assert(data.summary !== undefined, 'should have summary');
    console.log('✅ Basic endpoint access works');

    // Test 2: Filters
    console.log('\nTest 2: Filters...');
    assert(typeof data.filters.sinceMinutes === 'number', 'should have sinceMinutes');
    assert(typeof data.filters.bucketMinutes === 'number', 'should have bucketMinutes');
    console.log('✅ Filters present');

    // Test 3: Rollup statistics
    console.log('\nTest 3: Rollup statistics...');
    assert(typeof data.rollup.total_buckets === 'number', 'should have total_buckets');
    assert(typeof data.rollup.total_events === 'number', 'should have total_events');
    assert(typeof data.rollup.total_errors === 'number', 'should have total_errors');
    assert(typeof data.rollup.total_warns === 'number', 'should have total_warns');
    assert(typeof data.rollup.avg_events_per_bucket === 'number', 'should have avg_events_per_bucket');
    assert(typeof data.rollup.error_rate === 'string', 'should have error_rate');
    console.log('✅ Rollup statistics present');

    // Test 4: Trend direction
    console.log('\nTest 4: Trend direction...');
    assert(['increasing', 'decreasing', 'stable'].includes(data.rollup.trend_direction),
      'should have valid trend_direction');
    assert(typeof data.rollup.first_half_avg === 'number', 'should have first_half_avg');
    assert(typeof data.rollup.second_half_avg === 'number', 'should have second_half_avg');
    console.log(`   Trend: ${data.rollup.trend_direction}`);
    console.log('✅ Trend direction present');

    // Test 5: Peak bucket
    console.log('\nTest 5: Peak bucket...');
    if (data.rollup.peak_bucket) {
      assert(typeof data.rollup.peak_bucket.time === 'string', 'peak_bucket should have time');
      assert(typeof data.rollup.peak_bucket.total_events === 'number', 'peak_bucket should have total_events');
      console.log(`   Peak: ${data.rollup.peak_bucket.total_events} events at ${data.rollup.peak_bucket.time}`);
    }
    console.log('✅ Peak bucket present');

    // Test 6: Custom parameters
    console.log('\nTest 6: Custom parameters...');
    const customData = await fetchTrendRollup({ sinceMinutes: 60, bucketMinutes: 15 });
    assert(customData.filters.sinceMinutes === 60, 'should accept custom sinceMinutes');
    assert(customData.filters.bucketMinutes === 15, 'should accept custom bucketMinutes');
    console.log('✅ Custom parameters work');

    // Test 7: Timestamp
    console.log('\nTest 7: Timestamp...');
    assert(typeof data.generated_at === 'string', 'should have generated_at');
    console.log('✅ Timestamp present');

    console.log('\n✅ All trend rollup tests passed');
    console.log('\nRollup summary:');
    console.log(JSON.stringify(data.rollup, null, 2));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
