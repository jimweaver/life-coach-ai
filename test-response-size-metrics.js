#!/usr/bin/env node

/**
 * Test API response size metrics endpoint
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchResponseSizeMetrics() {
  const res = await fetch(`${API_BASE}/metrics/response-size`);
  return res.json();
}

async function generateTraffic(count = 5) {
  // Generate traffic to create response size stats
  for (let i = 0; i < count; i++) {
    await fetch(`${API_BASE}/health`);
    await fetch(`${API_BASE}/ready`);
    await fetch(`${API_BASE}/metrics/dashboard`);
    await fetch(`${API_BASE}/profile/${uuidv4()}`);
  }
}

async function run() {
  console.log('Testing API response size metrics...\n');

  try {
    // Test 1: Initial metrics state
    console.log('Test 1: Initial metrics state...');
    const initialMetrics = await fetchResponseSizeMetrics();
    assert(initialMetrics.ok === true, 'should return ok: true');
    assert(initialMetrics.histogram !== undefined, 'should have histogram');
    assert(typeof initialMetrics.total_responses === 'number', 'should have total_responses');
    assert(Array.isArray(initialMetrics.routes), 'should have routes array');
    assert(Array.isArray(initialMetrics.largest_routes), 'should have largest_routes array');
    console.log('✅ Initial metrics structure valid');

    // Test 2: Generate traffic
    console.log('\nTest 2: Generating traffic...');
    await generateTraffic(3);
    console.log('✅ Generated test traffic');

    // Test 3: Verify histogram updated
    console.log('\nTest 3: Verify histogram updated...');
    const updatedMetrics = await fetchResponseSizeMetrics();
    assert(updatedMetrics.total_responses >= initialMetrics.total_responses, 'total_responses should increase');

    // Check histogram has buckets
    const h = updatedMetrics.histogram;
    assert(typeof h.under1kb === 'number', 'should have under1kb bucket');
    assert(typeof h.under10kb === 'number', 'should have under10kb bucket');
    assert(typeof h.under50kb === 'number', 'should have under50kb bucket');
    assert(typeof h.under100kb === 'number', 'should have under100kb bucket');
    assert(typeof h.under500kb === 'number', 'should have under500kb bucket');
    assert(typeof h.under1mb === 'number', 'should have under1mb bucket');
    assert(typeof h.over1mb === 'number', 'should have over1mb bucket');

    const totalInHistogram = Object.values(h).reduce((a, b) => a + b, 0);
    assert(totalInHistogram > 0, 'histogram should have recorded responses');
    console.log(`   Total responses: ${updatedMetrics.total_responses}`);
    console.log('✅ Histogram updated correctly');

    // Test 4: Route stats
    console.log('\nTest 4: Route stats...');
    if (updatedMetrics.routes.length > 0) {
      const route = updatedMetrics.routes[0];
      assert(typeof route.route === 'string', 'route should have route path');
      assert(typeof route.count === 'number', 'route should have count');
      assert(typeof route.avg_kb === 'number', 'route should have avg_kb');
      assert(typeof route.total_mb === 'number', 'route should have total_mb');
      console.log('   Top routes:', updatedMetrics.routes.slice(0, 3).map(r => r.route));
    }
    console.log('✅ Route stats present');

    // Test 5: Largest routes
    console.log('\nTest 5: Largest routes...');
    if (updatedMetrics.largest_routes.length > 0) {
      const largest = updatedMetrics.largest_routes[0];
      assert(typeof largest.route === 'string', 'largest route should have route');
      assert(typeof largest.total_mb === 'number', 'largest route should have total_mb');
      assert(typeof largest.count === 'number', 'largest route should have count');
      console.log('   Largest routes:', updatedMetrics.largest_routes.slice(0, 3).map(r => r.route));
    }
    console.log('✅ Largest routes present');

    // Test 6: Timestamp
    console.log('\nTest 6: Timestamp...');
    assert(typeof updatedMetrics.generated_at === 'string', 'should have generated_at');
    console.log('✅ Timestamp present');

    console.log('\n✅ All response size metrics tests passed');
    console.log('\nSample histogram:');
    console.log(JSON.stringify(updatedMetrics.histogram, null, 2));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
