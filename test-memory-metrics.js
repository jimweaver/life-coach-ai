#!/usr/bin/env node

/**
 * Test memory usage metrics endpoint
 */

require('dotenv').config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchMemoryMetrics() {
  const res = await fetch(`${API_BASE}/metrics/memory`);
  return res.json();
}

async function run() {
  console.log('Testing memory usage metrics...\n');

  try {
    // Test 1: Basic endpoint access
    console.log('Test 1: Basic endpoint access...');
    const data = await fetchMemoryMetrics();
    assert(data.ok === true, 'should return ok: true');
    assert(typeof data.heap_used_mb === 'number', 'should have heap_used_mb');
    assert(typeof data.heap_total_mb === 'number', 'should have heap_total_mb');
    assert(typeof data.rss_mb === 'number', 'should have rss_mb');
    assert(typeof data.external_mb === 'number', 'should have external_mb');
    assert(typeof data.array_buffers_mb === 'number', 'should have array_buffers_mb');
    assert(typeof data.heap_utilization_percent === 'number', 'should have heap_utilization_percent');
    console.log('✅ Basic endpoint access works');

    // Test 2: System info
    console.log('\nTest 2: System info...');
    assert(typeof data.uptime_seconds === 'number', 'should have uptime_seconds');
    assert(typeof data.node_version === 'string', 'should have node_version');
    assert(typeof data.platform === 'string', 'should have platform');
    assert(typeof data.pid === 'number', 'should have pid');
    console.log(`   Node: ${data.node_version}, Platform: ${data.platform}, PID: ${data.pid}`);
    console.log('✅ System info present');

    // Test 3: Memory values are reasonable
    console.log('\nTest 3: Memory values are reasonable...');
    assert(data.heap_used_mb >= 0, 'heap_used_mb should be non-negative');
    assert(data.heap_total_mb >= 0, 'heap_total_mb should be non-negative');
    assert(data.rss_mb >= 0, 'rss_mb should be non-negative');
    assert(data.heap_utilization_percent >= 0 && data.heap_utilization_percent <= 100,
      'heap_utilization_percent should be between 0 and 100');
    console.log(`   Heap: ${data.heap_used_mb}MB / ${data.heap_total_mb}MB (${data.heap_utilization_percent}%)`);
    console.log('✅ Memory values are reasonable');

    // Test 4: Timestamp
    console.log('\nTest 4: Timestamp...');
    assert(typeof data.generated_at === 'string', 'should have generated_at');
    console.log('✅ Timestamp present');

    console.log('\n✅ All memory metrics tests passed');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
