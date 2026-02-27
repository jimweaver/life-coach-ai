#!/usr/bin/env node

/**
 * Test API latency histogram metrics endpoint
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchLatencyMetrics() {
  const res = await fetch(`${API_BASE}/metrics/latency`);
  return res.json();
}

async function makeRequests(count = 5) {
  const requests = [];
  for (let i = 0; i < count; i++) {
    requests.push(
      fetch(`${API_BASE}/health`),
      fetch(`${API_BASE}/ready`),
      fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: uuidv4(),
          message: 'Test message'
        })
      })
    );
  }
  await Promise.all(requests);
}

async function run() {
  console.log('Testing API latency histogram metrics...\n');

  try {
    // Test 1: Initial metrics state
    console.log('Test 1: Initial metrics state...');
    const initialMetrics = await fetchLatencyMetrics();
    assert(initialMetrics.ok === true, 'should return ok: true');
    assert(initialMetrics.histogram !== undefined, 'should have histogram');
    assert(typeof initialMetrics.total_requests === 'number', 'should have total_requests');
    assert(Array.isArray(initialMetrics.routes), 'should have routes array');
    console.log('✅ Initial metrics structure valid');

    // Test 2: Generate traffic
    console.log('\nTest 2: Generating traffic...');
    await makeRequests(3);
    console.log('✅ Generated test traffic');

    // Test 3: Verify histogram updated
    console.log('\nTest 3: Verify histogram updated...');
    const updatedMetrics = await fetchLatencyMetrics();
    assert(updatedMetrics.total_requests > initialMetrics.total_requests, 'total_requests should increase');
    
    // Check histogram has buckets
    const h = updatedMetrics.histogram;
    assert(typeof h.under10 === 'number', 'should have under10 bucket');
    assert(typeof h.under50 === 'number', 'should have under50 bucket');
    assert(typeof h.under100 === 'number', 'should have under100 bucket');
    assert(typeof h.under250 === 'number', 'should have under250 bucket');
    assert(typeof h.under500 === 'number', 'should have under500 bucket');
    assert(typeof h.under1000 === 'number', 'should have under1000 bucket');
    assert(typeof h.under2000 === 'number', 'should have under2000 bucket');
    assert(typeof h.over2000 === 'number', 'should have over2000 bucket');
    
    const totalInHistogram = Object.values(h).reduce((a, b) => a + b, 0);
    assert(totalInHistogram > 0, 'histogram should have recorded requests');
    console.log(`   Total requests: ${updatedMetrics.total_requests}`);
    console.log('✅ Histogram updated correctly');

    // Test 4: Route stats
    console.log('\nTest 4: Route stats...');
    assert(updatedMetrics.routes.length > 0, 'should have route stats');
    
    const route = updatedMetrics.routes[0];
    assert(typeof route.route === 'string', 'route should have route path');
    assert(typeof route.count === 'number', 'route should have count');
    assert(typeof route.avg_ms === 'number', 'route should have avg_ms');
    assert(typeof route.error_rate === 'string', 'route should have error_rate');
    console.log('   Top routes:', updatedMetrics.routes.slice(0, 3).map(r => r.route));
    console.log('✅ Route stats present');

    // Test 5: Timestamp
    console.log('\nTest 5: Timestamp...');
    assert(typeof updatedMetrics.generated_at === 'string', 'should have generated_at');
    console.log('✅ Timestamp present');

    // Test 6: Route count limits
    console.log('\nTest 6: Route count limits...');
    assert(updatedMetrics.routes.length <= 20, 'should limit to top 20 routes');
    console.log('✅ Route limit enforced');

    console.log('\n✅ All latency metrics tests passed');
    console.log('\nSample histogram:');
    console.log(JSON.stringify(updatedMetrics.histogram, null, 2));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
