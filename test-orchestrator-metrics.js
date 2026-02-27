#!/usr/bin/env node

/**
 * Test orchestrator performance metrics
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchMetrics() {
  const res = await fetch(`${API_BASE}/metrics/orchestrator`);
  return res.json();
}

async function sendChat(message) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: uuidv4(),
      message
    })
  });
  return res.json();
}

async function run() {
  console.log('Testing orchestrator performance metrics...\n');

  try {
    // Test 1: Initial metrics state
    console.log('Test 1: Initial metrics state...');
    const initialMetrics = await fetchMetrics();
    assert(initialMetrics.ok === true, 'should return ok: true');
    assert(initialMetrics.uptime_ms !== undefined, 'should have uptime_ms');
    assert(initialMetrics.requests !== undefined, 'should have requests');
    assert(initialMetrics.latency !== undefined, 'should have latency');
    assert(initialMetrics.errors !== undefined, 'should have errors');
    console.log('✅ Initial metrics structure valid');

    // Test 2: Send some requests to generate metrics
    console.log('\nTest 2: Generating metrics data...');
    await sendChat('我想轉職做軟件工程師');
    await sendChat('create a skill for gmail search');
    await sendChat('最近壓力很大');
    console.log('✅ Sent test requests');

    // Test 3: Verify metrics updated
    console.log('\nTest 3: Verify metrics updated...');
    const updatedMetrics = await fetchMetrics();
    assert(updatedMetrics.requests.total >= 3, 'should have at least 3 requests');
    assert(updatedMetrics.requests.by_mode['single-domain'] >= 1 ||
           updatedMetrics.requests.by_mode['multi-domain'] >= 1,
           'should have domain mode counts');
    assert(updatedMetrics.requests.by_mode['skill_learning'] >= 1,
           'should have skill_learning mode count');
    console.log(`   Total requests: ${updatedMetrics.requests.total}`);
    console.log('✅ Metrics updated correctly');

    // Test 4: Latency metrics
    console.log('\nTest 4: Latency metrics...');
    assert(typeof updatedMetrics.latency.average_ms === 'number', 'should have average latency');
    assert(updatedMetrics.latency.histogram !== undefined, 'should have histogram');
    assert(typeof updatedMetrics.latency.histogram.under100 === 'number', 'should have under100 bucket');
    assert(typeof updatedMetrics.latency.histogram.under500 === 'number', 'should have under500 bucket');
    assert(updatedMetrics.latency.percentiles !== undefined, 'should have percentiles');
    assert(typeof updatedMetrics.latency.percentiles.p50 === 'number', 'should have p50');
    assert(typeof updatedMetrics.latency.percentiles.p95 === 'number', 'should have p95');
    console.log(`   Average latency: ${updatedMetrics.latency.average_ms}ms`);
    console.log('✅ Latency metrics present');

    // Test 5: Domain tracking
    console.log('\nTest 5: Domain tracking...');
    assert(Object.keys(updatedMetrics.requests.by_domain).length > 0, 'should track domains');
    console.log('   Domains:', Object.keys(updatedMetrics.requests.by_domain));
    console.log('✅ Domain tracking works');

    // Test 6: Error tracking
    console.log('\nTest 6: Error tracking...');
    assert(typeof updatedMetrics.errors.total === 'number', 'should have error total');
    assert(typeof updatedMetrics.errors.rate === 'string', 'should have error rate');
    console.log(`   Error rate: ${updatedMetrics.errors.rate}`);
    console.log('✅ Error tracking present');

    // Test 7: Rate calculation
    console.log('\nTest 7: Rate calculation...');
    assert(typeof updatedMetrics.requests.rate_per_minute === 'string' ||
           typeof updatedMetrics.requests.rate_per_minute === 'number',
           'should have rate per minute');
    console.log(`   Rate: ${updatedMetrics.requests.rate_per_minute} req/min`);
    console.log('✅ Rate calculation works');

    console.log('\n✅ All orchestrator metrics tests passed');
    console.log('\nSample metrics:');
    console.log(JSON.stringify(updatedMetrics, null, 2));
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
